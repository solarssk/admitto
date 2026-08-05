import type { PrismaClient, BounceIngestSettings } from "@admitto/db";
import { applyBounceResult } from "./applyBounceResult.js";
import { findDeliveryForBounce, truncateEmailForLog } from "./correlate.js";
import { ImapInboundProvider } from "./imapProvider.js";
import { parseBounceLines } from "./parseBounceLine.js";
import { isUidProcessed, markUidProcessed } from "./processedUid.js";
import { lookbackSince, parseFolders, resolveImapConnectConfig } from "./resolveAuth.js";
import type { InboundMailProvider, InboundMessage, IngestSummary, ParsedBounceLine } from "./types.js";

export interface IngestBouncesOptions {
  /** Limit to one event (CLI `--event-id`). */
  eventId?: string;
  /** Inject provider factory for tests. */
  createProvider?: (settings: BounceIngestSettings) => Promise<InboundMailProvider>;
  log?: (msg: string) => void;
  env?: NodeJS.ProcessEnv;
}

function emptySummary(partial?: Partial<IngestSummary>): IngestSummary {
  return {
    eventsProcessed: 0,
    messagesSeen: 0,
    bouncesApplied: 0,
    softBouncesLogged: 0,
    unparsed: 0,
    noMatchingDelivery: 0,
    errors: 0,
    connectFailed: false,
    ...partial,
  };
}

async function openProvider(
  db: PrismaClient,
  settings: BounceIngestSettings,
  options: IngestBouncesOptions,
): Promise<InboundMailProvider> {
  if (options.createProvider) {
    return options.createProvider(settings);
  }
  const connectCfg = await resolveImapConnectConfig(db, settings, options.env ?? process.env);
  return new ImapInboundProvider(connectCfg);
}

async function maybeMarkSeen(
  provider: InboundMailProvider,
  folder: string,
  uid: string,
): Promise<void> {
  if (!provider.markSeen) return;
  try {
    await provider.markSeen(folder, uid);
  } catch {
    /* optional nicety */
  }
}

async function applyParsedLine(
  db: PrismaClient,
  settings: BounceIngestSettings,
  summary: IngestSummary,
  message: InboundMessage,
  line: ParsedBounceLine,
  log: (msg: string) => void,
): Promise<void> {
  try {
    const delivery = await findDeliveryForBounce(db, {
      eventId: settings.event_id,
      recipientEmail: line.recipientEmail,
    });
    if (!delivery) {
      summary.noMatchingDelivery += 1;
      log(
        `[bounce-ingest] no_matching_delivery event=${settings.event_id} uid=${message.uid} recipient=${truncateEmailForLog(line.recipientEmail)}`,
      );
      return;
    }
    const outcome = await applyBounceResult(db, delivery, line, log);
    if (outcome === "hard_bounced") summary.bouncesApplied += 1;
    else if (outcome === "soft_logged") summary.softBouncesLogged += 1;
  } catch (err) {
    summary.errors += 1;
    log(
      `[bounce-ingest] apply failed event=${settings.event_id} uid=${message.uid}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function processMessage(
  db: PrismaClient,
  settings: BounceIngestSettings,
  summary: IngestSummary,
  provider: InboundMailProvider,
  folder: string,
  message: InboundMessage,
  log: (msg: string) => void,
): Promise<void> {
  if (await isUidProcessed(db, settings.event_id, folder, message.uid)) return;

  summary.messagesSeen += 1;
  const lines = parseBounceLines(message.bodyText);

  if (lines.length === 0) {
    summary.unparsed += 1;
    log(
      `[bounce-ingest] unparsed_bounce event=${settings.event_id} folder=${folder} uid=${message.uid}`,
    );
    await markUidProcessed(db, settings.event_id, folder, message.uid);
    await maybeMarkSeen(provider, folder, message.uid);
    return;
  }

  for (const line of lines) {
    await applyParsedLine(db, settings, summary, message, line, log);
  }

  await markUidProcessed(db, settings.event_id, folder, message.uid);
  await maybeMarkSeen(provider, folder, message.uid);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function processFolder(
  db: PrismaClient,
  settings: BounceIngestSettings,
  summary: IngestSummary,
  provider: InboundMailProvider,
  folder: string,
  since: Date,
  log: (msg: string) => void,
): Promise<void> {
  let messages: InboundMessage[];
  try {
    messages = await provider.fetchCandidateMessages(folder, since);
  } catch (err) {
    summary.errors += 1;
    log(`[bounce-ingest] event=${settings.event_id} folder=${folder} fetch failed: ${errMsg(err)}`);
    return;
  }

  for (const message of messages) {
    try {
      await processMessage(db, settings, summary, provider, folder, message, log);
    } catch (err) {
      summary.errors += 1;
      log(
        `[bounce-ingest] message failed event=${settings.event_id} folder=${folder} uid=${message.uid}: ${errMsg(err)}`,
      );
    }
  }
}

async function ingestEvent(
  db: PrismaClient,
  settings: BounceIngestSettings,
  summary: IngestSummary,
  options: IngestBouncesOptions,
): Promise<void> {
  const log = options.log ?? console.error;

  let provider: InboundMailProvider;
  try {
    provider = await openProvider(db, settings, options);
    await provider.connect();
  } catch (err) {
    summary.connectFailed = true;
    summary.errors += 1;
    log(`[bounce-ingest] event=${settings.event_id} connect failed: ${errMsg(err)}`);
    return;
  }

  summary.eventsProcessed += 1;
  const since = lookbackSince();

  try {
    for (const folder of parseFolders(settings.folders)) {
      await processFolder(db, settings, summary, provider, folder, since, log);
    }
  } finally {
    try {
      await provider.close();
    } catch {
      /* ignore */
    }
  }
}

async function resolveRowsToProcess(
  db: PrismaClient,
  options: IngestBouncesOptions,
): Promise<{ rows: BounceIngestSettings[] } | { noop: IngestSummary }> {
  const where = options.eventId ? { event_id: options.eventId } : { enabled: true };
  const rows = await db.bounceIngestSettings.findMany({ where });

  if (rows.length === 0) {
    if (options.eventId) {
      const any = await db.bounceIngestSettings.findUnique({
        where: { event_id: options.eventId },
      });
      if (!any) return { noop: emptySummary({ noopReason: "not_configured" }) };
      if (!any.enabled) return { noop: emptySummary({ noopReason: "disabled" }) };
    }
    return { noop: emptySummary({ noopReason: "none_enabled" }) };
  }

  if (options.eventId && rows.length === 1 && !rows[0]!.enabled) {
    return { noop: emptySummary({ noopReason: "disabled" }) };
  }

  const toProcess = options.eventId ? rows.filter((r) => r.enabled) : rows;
  if (toProcess.length === 0) {
    return { noop: emptySummary({ noopReason: "disabled" }) };
  }
  return { rows: toProcess };
}

/**
 * Ingest bounce/NDR messages for all enabled event settings (or one event).
 * No-op when nothing is configured / enabled — not an error.
 */
export async function ingestBounces(
  db: PrismaClient,
  options: IngestBouncesOptions = {},
): Promise<IngestSummary> {
  const resolved = await resolveRowsToProcess(db, options);
  if ("noop" in resolved) return resolved.noop;

  const summary = emptySummary();
  for (const settings of resolved.rows) {
    await ingestEvent(db, settings, summary, options);
  }
  return summary;
}

function imapErrorDetail(err: unknown): string {
  const responseText =
    err && typeof err === "object" && "responseText" in err && typeof err.responseText === "string"
      ? err.responseText
      : undefined;
  const message = err instanceof Error ? err.message : String(err);
  // ImapFlow often returns opaque "Command failed"; responseText has the usable reason.
  return [message, responseText].filter(Boolean).join(": ");
}

/** Test IMAP credentials + first folder without fetching/processing messages. */
export async function testBounceImapConnection(
  db: PrismaClient,
  settings: BounceIngestSettings,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; foldersChecked: number } | { ok: false; error: string }> {
  try {
    const connectCfg = await resolveImapConnectConfig(db, settings, env);
    const provider = new ImapInboundProvider(connectCfg);
    await provider.connect();
    try {
      const folders = parseFolders(settings.folders);
      await provider.probeFolder(folders[0]!);
      return { ok: true, foldersChecked: 1 };
    } finally {
      await provider.close();
    }
  } catch (err) {
    return { ok: false, error: imapErrorDetail(err) };
  }
}

export type {
  InboundMessage,
  InboundMailProvider,
  ParsedBounceLine,
  IngestSummary,
  ImapConnectConfig,
} from "./types.js";
export { parseBounceLines, parseRfc3464DsnBlocks } from "./parseBounceLine.js";
export { findDeliveryForBounce, truncateEmailForLog } from "./correlate.js";
export { applyBounceResult } from "./applyBounceResult.js";
export type { ApplyBounceOutcome } from "./applyBounceResult.js";
export { ImapInboundProvider, extractPlainTextFromSource, MAX_BODY_BYTES } from "./imapProvider.js";
export {
  parseFolders,
  lookbackSince,
  resolveImapConnectConfig,
  BounceAuthError,
  DEFAULT_BOUNCE_FOLDERS,
  LOOKBACK_DAYS,
} from "./resolveAuth.js";
