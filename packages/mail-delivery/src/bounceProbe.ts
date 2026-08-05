import type { PrismaClient, BounceIngestSettings } from "@admitto/db";
import { isSendSuccess, type MailerProvider, type SendResult } from "@admitto/mailer";
import { resolveMailConfig } from "@admitto/mailer-config";
import { buildErrorCode } from "./bounceIngest/applyBounceResult.js";
import { parseBounceLines } from "./bounceIngest/parseBounceLine.js";
import { ImapInboundProvider } from "./bounceIngest/imapProvider.js";
import { markUidProcessed } from "./bounceIngest/processedUid.js";
import {
  lookbackSince,
  parseFolders,
  resolveImapConnectConfig,
} from "./bounceIngest/resolveAuth.js";
import type { InboundMailProvider, ParsedBounceLine } from "./bounceIngest/types.js";
import { imapTestErrorForAdmin, transportTestErrorForAdmin } from "./sanitizeError.js";
import type { MailDeliveryDeps } from "./send.js";
import { sendEventTransportTestEmail } from "./transportTest.js";

export const BOUNCE_PROBE_TIMEOUT_MS = 90_000;
export const BOUNCE_PROBE_POLL_MS = 5_000;

export type BounceProbeStatus = "ok" | "timeout" | "failed";

export interface BounceProbeResult {
  status: BounceProbeStatus;
  message: string;
  smtpCode?: string | null;
  sendResult: SendResult;
}

export interface RunEventBounceProbeParams {
  eventId: string;
  toAddress: string;
  /** Override wait budget (tests). */
  timeoutMs?: number;
  /** Override poll interval (tests). */
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Inject IMAP provider factory (tests) - same hook shape as ingestBounces. */
  ingestOptions?: {
    createProvider?: (settings: BounceIngestSettings) => Promise<InboundMailProvider>;
    env?: NodeJS.ProcessEnv;
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHardBounce(line: ParsedBounceLine): boolean {
  return line.smtpCode.startsWith("5");
}

async function openProbeProvider(
  db: PrismaClient,
  settings: BounceIngestSettings,
  params: {
    createProvider?: (settings: BounceIngestSettings) => Promise<InboundMailProvider>;
    env?: NodeJS.ProcessEnv;
  },
): Promise<InboundMailProvider> {
  if (params.createProvider) return params.createProvider(settings);
  const connectCfg = await resolveImapConnectConfig(db, settings, params.env ?? process.env);
  return new ImapInboundProvider(connectCfg);
}

/**
 * One IMAP pass: look for a hard (5xx) bounce whose recipient matches `recipientEmail`.
 * Uses the same parseBounceLines path as production ingest, but does not create or update
 * EmailDelivery / Attendee rows (plain Send test also leaves no delivery trail).
 *
 * Probe path deliberately does NOT skip via BounceIngestProcessedUid: the sidecar can mark
 * the probe's NDR before this poll sees it, which would yield a false timeout. Session-local
 * `examinedUids` avoids re-parsing the same UID within this probe; a hard-bounce hit still
 * calls markUidProcessed so the sidecar does not keep counting noMatchingDelivery.
 */
async function scanFoldersForHardBounce(
  db: PrismaClient,
  args: {
    eventId: string;
    folders: string[];
    since: Date;
    want: string;
    provider: InboundMailProvider;
    examinedUids: Set<string>;
  },
): Promise<{ smtpCode: string; reason: string } | null> {
  for (const folder of args.folders) {
    const hit = await scanFolderForHardBounce(db, {
      eventId: args.eventId,
      folder,
      since: args.since,
      want: args.want,
      provider: args.provider,
      examinedUids: args.examinedUids,
    });
    if (hit) return hit;
  }
  return null;
}

async function scanFolderForHardBounce(
  db: PrismaClient,
  args: {
    eventId: string;
    folder: string;
    since: Date;
    want: string;
    provider: InboundMailProvider;
    examinedUids: Set<string>;
  },
): Promise<{ smtpCode: string; reason: string } | null> {
  // Do not pass skipUids from BounceIngestProcessedUid (sidecar race). Fetch all candidates;
  // filter only with the in-session examined set.
  const messages = await args.provider.fetchCandidateMessages(args.folder, args.since);

  for (const message of messages) {
    const examKey = `${args.folder}\0${message.uid}`;
    if (args.examinedUids.has(examKey)) continue;
    args.examinedUids.add(examKey);

    const hit = parseBounceLines(message.bodyText).find(
      (line) => line.recipientEmail.trim().toLowerCase() === args.want && isHardBounce(line),
    );
    if (!hit) continue;

    await markUidProcessed(db, args.eventId, args.folder, message.uid);
    if (args.provider.markSeen) {
      try {
        await args.provider.markSeen(args.folder, message.uid);
      } catch {
        /* optional */
      }
    }
    return { smtpCode: buildErrorCode(hit), reason: hit.reason };
  }
  return null;
}

/**
 * Send a transport-level test message (no EmailDelivery / Attendee row, same as a plain Send
 * test), then poll the event's bounce IMAP mailbox until a hard bounce for that To address
 * appears or the timeout elapses.
 */
export async function runEventBounceProbe(
  params: RunEventBounceProbeParams,
  db: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  deps: MailDeliveryDeps = {},
): Promise<BounceProbeResult> {
  const {
    eventId,
    toAddress,
    timeoutMs = BOUNCE_PROBE_TIMEOUT_MS,
    pollMs = BOUNCE_PROBE_POLL_MS,
    sleep = defaultSleep,
    now = Date.now,
    ingestOptions = {},
  } = params;

  const bounceSettings = await db.bounceIngestSettings.findUnique({
    where: { event_id: eventId },
  });
  if (!bounceSettings?.imap_host) {
    throw new BounceProbeSetupError("Configure and save bounce detection settings first.");
  }
  if (!bounceSettings.enabled) {
    throw new BounceProbeSetupError("Turn bounce detection On and save before verifying bounce.");
  }

  let sendResult: SendResult;
  try {
    sendResult = await sendEventTransportTestEmail({ eventId, toAddress }, db, env, deps);
  } catch (err) {
    // Same operator-safe mapping as plain Send test (`runTransportTest`): setup failures
    // (no provider, export_only without sink, blocked/unresolvable SMTP host) must not
    // bubble as 500 from the admin route.
    const raw = err instanceof Error ? err.message : undefined;
    const message = transportTestErrorForAdmin(raw);
    let provider: MailerProvider = "export_only";
    try {
      provider = (await resolveMailConfig(eventId, db, env)).provider;
    } catch {
      /* pre-config failure — keep neutral export_only */
    }
    return {
      status: "failed",
      message,
      sendResult: {
        status: "rejected",
        provider,
        error: message,
        retryable: false,
      },
    };
  }

  if (!isSendSuccess(sendResult.status) || sendResult.error) {
    return {
      status: "failed",
      message: sendResult.error ?? "Send failed before bounce wait.",
      sendResult,
    };
  }

  const recipient = toAddress.trim().toLowerCase();
  const folders = parseFolders(bounceSettings.folders);
  const since = lookbackSince();
  const provider = await openProbeProvider(db, bounceSettings, {
    createProvider: ingestOptions.createProvider,
    env: ingestOptions.env ?? env,
  });

  const examinedUids = new Set<string>();
  let everConnected = false;
  let reconnectUsed = false;
  let lastImapError: string | undefined;
  const waitSeconds = Math.max(1, Math.round(timeoutMs / 1000));

  try {
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      try {
        if (!everConnected) {
          await provider.connect();
          everConnected = true;
        }

        const hit = await scanFoldersForHardBounce(db, {
          eventId,
          folders,
          since,
          want: recipient,
          provider,
          examinedUids,
        });
        if (hit) {
          return {
            status: "ok",
            message: `Bounce received (${hit.smtpCode}). Detection can read delivery failures from the bounce mailbox.`,
            smtpCode: hit.smtpCode,
            sendResult,
          };
        }
      } catch (err) {
        lastImapError = err instanceof Error ? err.message : String(err);
        console.error(`[bounce-probe] IMAP poll failed: ${lastImapError}`);

        // Mid-loop disconnect: allow one reconnect attempt for the remainder of the wait.
        if (everConnected && !reconnectUsed) {
          reconnectUsed = true;
          everConnected = false;
          try {
            await provider.close();
          } catch {
            /* ignore */
          }
        }
      }

      const remaining = deadline - now();
      if (remaining <= 0) break;
      await sleep(Math.min(pollMs, remaining));
    }
  } finally {
    try {
      await provider.close();
    } catch {
      /* ignore */
    }
  }

  if (!everConnected) {
    return {
      status: "failed",
      message: imapTestErrorForAdmin(lastImapError),
      sendResult,
    };
  }

  return {
    status: "timeout",
    message: `Mail was accepted by the transport, but no matching bounce appeared in IMAP within ${waitSeconds} seconds. Check the bounce folder, forward rule, and try again.`,
    sendResult,
  };
}

export class BounceProbeSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BounceProbeSetupError";
  }
}
