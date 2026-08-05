import type { PrismaClient, BounceIngestSettings, EmailDelivery } from "@admitto/db";
import { applyBounceResult } from "./applyBounceResult.js";
import {
  findDeliveriesForBounceBatch,
  normalizeBounceRecipientEmail,
  truncateEmailForLog,
} from "./correlate.js";
import { ImapInboundProvider } from "./imapProvider.js";
import { parseBounceLines } from "./parseBounceLine.js";
import { listProcessedUids, markUidProcessed, pruneProcessedUidsOlderThan } from "./processedUid.js";
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

/** Cap concurrent event IMAP sessions so one slow host does not serialize the whole run. */
const INGEST_EVENT_CONCURRENCY = 3;

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

function mergeSummaries(into: IngestSummary, from: IngestSummary): void {
  into.eventsProcessed += from.eventsProcessed;
  into.messagesSeen += from.messagesSeen;
  into.bouncesApplied += from.bouncesApplied;
  into.softBouncesLogged += from.softBouncesLogged;
  into.unparsed += from.unparsed;
  into.noMatchingDelivery += from.noMatchingDelivery;
  into.errors += from.errors;
  into.connectFailed = into.connectFailed || from.connectFailed;
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
  uids: string[],
): Promise<void> {
  if (!provider.markSeen || uids.length === 0) return;
  try {
    await provider.markSeen(folder, uids);
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
  deliveryByRecipient: Map<string, EmailDelivery>,
): Promise<void> {
  try {
    const key = normalizeBounceRecipientEmail(line.recipientEmail);
    const delivery = deliveryByRecipient.get(key) ?? null;
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

/** Process one fetched message. Caller already skipped processed UIDs before FETCH. */
async function processMessage(
  db: PrismaClient,
  settings: BounceIngestSettings,
  summary: IngestSummary,
  folder: string,
  message: InboundMessage,
  lines: ParsedBounceLine[],
  log: (msg: string) => void,
  markedSeenUids: string[],
  deliveryByRecipient: Map<string, EmailDelivery>,
): Promise<void> {
  summary.messagesSeen += 1;

  if (lines.length === 0) {
    summary.unparsed += 1;
    log(
      `[bounce-ingest] unparsed_bounce event=${settings.event_id} folder=${folder} uid=${message.uid}`,
    );
    await markUidProcessed(db, settings.event_id, folder, message.uid);
    markedSeenUids.push(message.uid);
    return;
  }

  for (const line of lines) {
    await applyParsedLine(db, settings, summary, message, line, log, deliveryByRecipient);
  }

  await markUidProcessed(db, settings.event_id, folder, message.uid);
  markedSeenUids.push(message.uid);
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
  let skipUids: Set<string>;
  try {
    skipUids = await listProcessedUids(db, settings.event_id, folder);
  } catch (err) {
    summary.errors += 1;
    log(
      `[bounce-ingest] event=${settings.event_id} folder=${folder} list processed UIDs failed: ${errMsg(err)}`,
    );
    return;
  }

  let messages: InboundMessage[];
  try {
    messages = await provider.fetchCandidateMessages(folder, since, { skipUids });
  } catch (err) {
    summary.errors += 1;
    log(`[bounce-ingest] event=${settings.event_id} folder=${folder} fetch failed: ${errMsg(err)}`);
    return;
  }

  // Defense for test doubles / providers that ignore skipUids.
  if (skipUids.size > 0) {
    messages = messages.filter((m) => !skipUids.has(m.uid));
  }

  const parsed = messages.map((message) => ({
    message,
    lines: parseBounceLines(message.bodyText),
  }));
  const recipientEmails = parsed.flatMap(({ lines }) => lines.map((l) => l.recipientEmail));
  let deliveryByRecipient: Map<string, EmailDelivery>;
  try {
    deliveryByRecipient = await findDeliveriesForBounceBatch(db, {
      eventId: settings.event_id,
      recipientEmails,
    });
  } catch (err) {
    summary.errors += 1;
    log(
      `[bounce-ingest] event=${settings.event_id} folder=${folder} batch delivery lookup failed: ${errMsg(err)}`,
    );
    return;
  }

  const markedSeenUids: string[] = [];
  for (const { message, lines } of parsed) {
    try {
      await processMessage(
        db,
        settings,
        summary,
        folder,
        message,
        lines,
        log,
        markedSeenUids,
        deliveryByRecipient,
      );
    } catch (err) {
      summary.errors += 1;
      log(
        `[bounce-ingest] message failed event=${settings.event_id} folder=${folder} uid=${message.uid}: ${errMsg(err)}`,
      );
    }
  }

  await maybeMarkSeen(provider, folder, markedSeenUids);
}

async function ingestEvent(
  db: PrismaClient,
  settings: BounceIngestSettings,
  options: IngestBouncesOptions,
): Promise<IngestSummary> {
  const summary = emptySummary();
  const log = options.log ?? console.error;

  let provider: InboundMailProvider;
  try {
    provider = await openProvider(db, settings, options);
    await provider.connect();
  } catch (err) {
    summary.connectFailed = true;
    summary.errors += 1;
    log(`[bounce-ingest] event=${settings.event_id} connect failed: ${errMsg(err)}`);
    return summary;
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

  return summary;
}

async function resolveRowsToProcess(
  db: PrismaClient,
  options: IngestBouncesOptions,
): Promise<{ rows: BounceIngestSettings[] } | { noop: IngestSummary }> {
  if (options.eventId) {
    const row = await db.bounceIngestSettings.findUnique({
      where: { event_id: options.eventId },
    });
    if (!row) return { noop: emptySummary({ noopReason: "not_configured" }) };
    if (!row.enabled) return { noop: emptySummary({ noopReason: "disabled" }) };
    return { rows: [row] };
  }

  const rows = await db.bounceIngestSettings.findMany({ where: { enabled: true } });
  if (rows.length === 0) {
    return { noop: emptySummary({ noopReason: "none_enabled" }) };
  }
  return { rows };
}

/** Run `fn` over items with at most `concurrency` in flight; wait for each chunk via allSettled. */
async function mapSettledInChunks<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<IngestSummary>,
): Promise<IngestSummary[]> {
  const results: IngestSummary[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(chunk.map((item) => fn(item)));
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
      } else {
        results.push(emptySummary({ errors: 1 }));
      }
    }
  }
  return results;
}

/**
 * Ingest bounce/NDR messages for all enabled event settings (or one event).
 * No-op when nothing is configured / enabled - not an error.
 */
export async function ingestBounces(
  db: PrismaClient,
  options: IngestBouncesOptions = {},
): Promise<IngestSummary> {
  const resolved = await resolveRowsToProcess(db, options);
  if ("noop" in resolved) return resolved.noop;

  const perEvent = await mapSettledInChunks(resolved.rows, INGEST_EVENT_CONCURRENCY, (settings) =>
    ingestEvent(db, settings, options),
  );

  const summary = emptySummary();
  for (const part of perEvent) {
    mergeSummaries(summary, part);
  }

  // Drop UID markers older than the IMAP lookback window (best-effort; do not
  // inflate summary.errors / CLI exit - prune is maintenance, not ingest failure).
  try {
    await pruneProcessedUidsOlderThan(db);
  } catch (err) {
    (options.log ?? console.error)(
      `[bounce-ingest] prune processed UIDs failed: ${err instanceof Error ? err.message : String(err)}`,
    );
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
  FetchCandidateOptions,
} from "./types.js";
export { parseBounceLines, parseRfc3464DsnBlocks } from "./parseBounceLine.js";
export {
  findDeliveryForBounce,
  findDeliveriesForBounceBatch,
  truncateEmailForLog,
  NON_TERMINAL,
} from "./correlate.js";
export { applyBounceResult, buildErrorCode } from "./applyBounceResult.js";
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
