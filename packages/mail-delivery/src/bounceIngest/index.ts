import type { PrismaClient, BounceIngestSettings } from "@admitto/db";
import { applyBounceResult } from "./applyBounceResult.js";
import { findDeliveryForBounce, truncateEmailForLog } from "./correlate.js";
import { ImapInboundProvider } from "./imapProvider.js";
import { parseBounceLines } from "./parseBounceLine.js";
import { lookbackSince, parseFolders, resolveImapConnectConfig } from "./resolveAuth.js";
import type { InboundMailProvider, IngestSummary } from "./types.js";

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

async function markUidProcessed(
  db: PrismaClient,
  eventId: string,
  folder: string,
  uid: string,
): Promise<void> {
  await db.bounceIngestProcessedUid.upsert({
    where: {
      event_id_folder_uid: { event_id: eventId, folder, uid },
    },
    create: { event_id: eventId, folder, uid },
    update: { processed_at: new Date() },
  });
}

async function isUidProcessed(
  db: PrismaClient,
  eventId: string,
  folder: string,
  uid: string,
): Promise<boolean> {
  const row = await db.bounceIngestProcessedUid.findUnique({
    where: {
      event_id_folder_uid: { event_id: eventId, folder, uid },
    },
    select: { id: true },
  });
  return row !== null;
}

async function ingestEvent(
  db: PrismaClient,
  settings: BounceIngestSettings,
  summary: IngestSummary,
  options: IngestBouncesOptions,
): Promise<void> {
  const log = options.log ?? console.error;
  const env = options.env ?? process.env;

  let provider: InboundMailProvider;
  try {
    if (options.createProvider) {
      provider = await options.createProvider(settings);
    } else {
      const connectCfg = await resolveImapConnectConfig(db, settings, env);
      provider = new ImapInboundProvider(connectCfg);
    }
    await provider.connect();
  } catch (err) {
    summary.connectFailed = true;
    summary.errors += 1;
    log(
      `[bounce-ingest] event=${settings.event_id} connect failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  summary.eventsProcessed += 1;
  const folders = parseFolders(settings.folders);
  const since = lookbackSince();

  try {
    for (const folder of folders) {
      let messages;
      try {
        messages = await provider.fetchCandidateMessages(folder, since);
      } catch (err) {
        summary.errors += 1;
        log(
          `[bounce-ingest] event=${settings.event_id} folder=${folder} fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      for (const message of messages) {
        try {
          if (await isUidProcessed(db, settings.event_id, folder, message.uid)) {
            continue;
          }

          summary.messagesSeen += 1;
          const lines = parseBounceLines(message.bodyText);

          if (lines.length === 0) {
            summary.unparsed += 1;
            log(
              `[bounce-ingest] unparsed_bounce event=${settings.event_id} folder=${folder} uid=${message.uid}`,
            );
            await markUidProcessed(db, settings.event_id, folder, message.uid);
            if (provider.markSeen) {
              try {
                await provider.markSeen(folder, message.uid);
              } catch {
                /* optional nicety */
              }
            }
            continue;
          }

          for (const line of lines) {
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
                continue;
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

          await markUidProcessed(db, settings.event_id, folder, message.uid);
          if (provider.markSeen) {
            try {
              await provider.markSeen(folder, message.uid);
            } catch {
              /* optional nicety */
            }
          }
        } catch (err) {
          summary.errors += 1;
          log(
            `[bounce-ingest] message failed event=${settings.event_id} folder=${folder} uid=${message.uid}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  } finally {
    try {
      await provider.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Ingest bounce/NDR messages for all enabled event settings (or one event).
 * No-op when nothing is configured / enabled — not an error.
 */
export async function ingestBounces(
  db: PrismaClient,
  options: IngestBouncesOptions = {},
): Promise<IngestSummary> {
  const where = options.eventId
    ? { event_id: options.eventId }
    : { enabled: true };

  const rows = await db.bounceIngestSettings.findMany({ where });

  if (rows.length === 0) {
    if (options.eventId) {
      const any = await db.bounceIngestSettings.findUnique({
        where: { event_id: options.eventId },
      });
      if (!any) return emptySummary({ noopReason: "not_configured" });
      if (!any.enabled) return emptySummary({ noopReason: "disabled" });
    }
    return emptySummary({ noopReason: "none_enabled" });
  }

  // Single-event path: respect disabled explicitly
  if (options.eventId && rows.length === 1 && !rows[0]!.enabled) {
    return emptySummary({ noopReason: "disabled" });
  }

  const toProcess = options.eventId ? rows.filter((r) => r.enabled) : rows;
  if (toProcess.length === 0) {
    return emptySummary({ noopReason: "disabled" });
  }

  const summary = emptySummary();
  for (const settings of toProcess) {
    await ingestEvent(db, settings, summary, options);
  }
  return summary;
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
      if (folders.length === 0) {
        return { ok: false, error: "No folders configured" };
      }
      await provider.probeFolder(folders[0]!);
      return { ok: true, foldersChecked: 1 };
    } finally {
      await provider.close();
    }
  } catch (err) {
    const responseText =
      err && typeof err === "object" && "responseText" in err && typeof err.responseText === "string"
        ? err.responseText
        : undefined;
    const message = err instanceof Error ? err.message : String(err);
    // ImapFlow often returns opaque "Command failed"; responseText has the usable reason.
    const detail = [message, responseText].filter(Boolean).join(": ");
    return {
      ok: false,
      error: detail,
    };
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
