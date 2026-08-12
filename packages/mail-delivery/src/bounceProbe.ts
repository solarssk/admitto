import type { PrismaClient, BounceIngestSettings } from "@admitto/db";
import { isSendSuccess, type MailerProvider, type SendResult } from "@admitto/mailer";
import { resolveMailConfig } from "@admitto/mailer-config";
import { buildErrorCode } from "./bounceIngest/applyBounceResult.js";
import { openBounceImapProvider } from "./bounceIngest/openProvider.js";
import { parseBounceLines } from "./bounceIngest/parseBounceLine.js";
import { markUidProcessed } from "./bounceIngest/processedUid.js";
import { BounceAuthError, parseFolders } from "./bounceIngest/resolveAuth.js";
import type { InboundMailProvider, ParsedBounceLine } from "./bounceIngest/types.js";
import { imapTestErrorForAdmin, transportTestErrorForAdmin } from "./sanitizeError.js";
import type { MailDeliveryDeps } from "./send.js";
import { sendEventTransportTestEmail } from "./transportTest.js";

export const BOUNCE_PROBE_TIMEOUT_MS = 90_000;
export const BOUNCE_PROBE_POLL_MS = 5_000;
/** Allow small SMTP/IMAP clock skew when filtering NDRs to this probe run. */
export const BOUNCE_PROBE_SINCE_SKEW_MS = 60_000;

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

function failedProbe(sendResult: SendResult, message: string): BounceProbeResult {
  return { status: "failed", message, sendResult };
}

/**
 * One IMAP pass: look for a hard (5xx) bounce whose recipient matches `recipientEmail`
 * and whose IMAP `receivedAt` is not older than this probe (`notBefore`).
 * Uses the same parseBounceLines path as production ingest, but does not create or update
 * EmailDelivery / Attendee rows (plain Send test also leaves no delivery trail).
 *
 * Probe path deliberately does NOT skip via BounceIngestProcessedUid: the sidecar can mark
 * the probe's NDR before this poll sees it, which would yield a false timeout. Session-local
 * `examinedUids` avoids re-parsing the same UID within this probe; a hard-bounce hit still
 * calls markUidProcessed so the sidecar does not keep counting noMatchingDelivery.
 *
 * IMAP SEARCH SINCE is day-granular on many servers, so `receivedAt >= notBefore` is what
 * keeps an older same-recipient NDR from counting as success for this probe.
 */
async function scanFoldersForHardBounce(
  db: PrismaClient,
  args: {
    eventId: string;
    folders: string[];
    since: Date;
    notBefore: Date;
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
      notBefore: args.notBefore,
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
    notBefore: Date;
    want: string;
    provider: InboundMailProvider;
    examinedUids: Set<string>;
  },
): Promise<{ smtpCode: string; reason: string } | null> {
  // Do not pass skipUids from BounceIngestProcessedUid (sidecar race). Fetch all candidates;
  // filter only with the in-session examined set + probe-start receivedAt gate.
  const messages = await args.provider.fetchCandidateMessages(args.folder, args.since);
  const notBeforeMs = args.notBefore.getTime();

  for (const message of messages) {
    const examKey = `${args.folder}\0${message.uid}`;
    if (args.examinedUids.has(examKey)) continue;
    args.examinedUids.add(examKey);

    if (message.receivedAt.getTime() < notBeforeMs) continue;

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

async function sendProbeTransportTest(
  eventId: string,
  toAddress: string,
  db: PrismaClient,
  env: NodeJS.ProcessEnv,
  deps: MailDeliveryDeps,
): Promise<{ ok: true; sendResult: SendResult } | { ok: false; result: BounceProbeResult }> {
  try {
    const sendResult = await sendEventTransportTestEmail({ eventId, toAddress }, db, env, deps);
    if (!isSendSuccess(sendResult.status) || sendResult.error) {
      return {
        ok: false,
        result: failedProbe(sendResult, sendResult.error ?? "Send failed before bounce wait."),
      };
    }
    return { ok: true, sendResult };
  } catch (err) {
    // Same operator-safe mapping as plain Send test (`runTransportTest`): setup failures
    // must not bubble as 500 from the admin route.
    const raw = err instanceof Error ? err.message : undefined;
    const message = transportTestErrorForAdmin(raw);
    let provider: MailerProvider = "export_only";
    try {
      provider = (await resolveMailConfig(eventId, db, env)).provider;
    } catch {
      /* pre-config failure — keep neutral export_only */
    }
    return {
      ok: false,
      result: failedProbe(
        { status: "rejected", provider, error: message, retryable: false },
        message,
      ),
    };
  }
}

async function softCloseProvider(provider: InboundMailProvider): Promise<void> {
  try {
    await provider.close();
  } catch {
    /* ignore */
  }
}

type PollHit = { smtpCode: string; reason: string };

type PollSessionState = {
  everConnected: boolean;
  reconnectUsed: boolean;
  lastImapError?: string;
};

async function executePollPass(
  provider: InboundMailProvider,
  state: PollSessionState,
  scanArgs: {
    db: PrismaClient;
    eventId: string;
    folders: string[];
    since: Date;
    notBefore: Date;
    want: string;
    examinedUids: Set<string>;
  },
): Promise<PollHit | null> {
  try {
    if (!state.everConnected) {
      await provider.connect();
      state.everConnected = true;
    }

    const hit = await scanFoldersForHardBounce(scanArgs.db, {
      eventId: scanArgs.eventId,
      folders: scanArgs.folders,
      since: scanArgs.since,
      notBefore: scanArgs.notBefore,
      want: scanArgs.want,
      provider,
      examinedUids: scanArgs.examinedUids,
    });
    if (hit) return hit;
    return null;
  } catch (err) {
    state.lastImapError = err instanceof Error ? err.message : String(err);
    console.error(`[bounce-probe] IMAP poll failed: ${state.lastImapError}`);

    if (state.everConnected && !state.reconnectUsed) {
      state.reconnectUsed = true;
      state.everConnected = false;
      await softCloseProvider(provider);
    }
    return null;
  }
}

async function pollForHardBounce(args: {
  db: PrismaClient;
  eventId: string;
  folders: string[];
  since: Date;
  notBefore: Date;
  want: string;
  provider: InboundMailProvider;
  timeoutMs: number;
  pollMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}): Promise<{ hit: PollHit | null; everConnected: boolean; lastImapError?: string }> {
  const examinedUids = new Set<string>();
  const state: PollSessionState = { everConnected: false, reconnectUsed: false };
  const deadline = args.now() + args.timeoutMs;

  try {
    while (args.now() < deadline) {
      const hit = await executePollPass(args.provider, state, {
        db: args.db,
        eventId: args.eventId,
        folders: args.folders,
        since: args.since,
        notBefore: args.notBefore,
        want: args.want,
        examinedUids,
      });
      if (hit) return { hit, everConnected: state.everConnected, lastImapError: state.lastImapError };

      const remaining = deadline - args.now();
      if (remaining <= 0) break;
      await args.sleep(Math.min(args.pollMs, remaining));
    }
  } finally {
    await softCloseProvider(args.provider);
  }

  return { hit: null, everConnected: state.everConnected, lastImapError: state.lastImapError };
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

  const sendOutcome = await sendProbeTransportTest(eventId, toAddress, db, env, deps);
  if (!sendOutcome.ok) return sendOutcome.result;
  const { sendResult } = sendOutcome;

  const recipient = toAddress.trim().toLowerCase();
  const folders = parseFolders(bounceSettings.folders);
  // Wall clock (not the injectable `now` used for the wait deadline): IMAP internalDate and
  // SMTP clocks are real-world. Narrow SEARCH + receivedAt so a stale same-recipient NDR in
  // the 14-day ingest window cannot make "Also verify bounce" succeed without a fresh bounce.
  const notBefore = new Date(Date.now() - BOUNCE_PROBE_SINCE_SKEW_MS);

  let provider: InboundMailProvider;
  try {
    provider = await openBounceImapProvider(db, bounceSettings, {
      createProvider: ingestOptions.createProvider,
      env: ingestOptions.env ?? env,
    });
  } catch (err) {
    // BounceAuthError is always operator-safe text by construction (missing/invalid IMAP
    // settings, or an undecryptable stored secret) — surface it directly instead of the
    // generic fallback below, which would otherwise hide e.g. mail_secret_decryption_failed.
    if (err instanceof BounceAuthError) {
      console.error(`[bounce-probe] IMAP open failed: ${err.message}`);
      return failedProbe(sendResult, err.message);
    }
    const raw = err instanceof Error ? err.message : String(err);
    console.error(`[bounce-probe] IMAP open failed: ${raw}`);
    return failedProbe(
      sendResult,
      "Could not open the bounce mailbox. Check IMAP settings and try again.",
    );
  }

  const waitSeconds = Math.max(1, Math.round(timeoutMs / 1000));
  const { hit, everConnected, lastImapError } = await pollForHardBounce({
    db,
    eventId,
    folders,
    since: notBefore,
    notBefore,
    want: recipient,
    provider,
    timeoutMs,
    pollMs,
    sleep,
    now,
  });

  if (hit) {
    return {
      status: "ok",
      message: `Bounce received (${hit.smtpCode}). Detection can read delivery failures from the bounce mailbox.`,
      smtpCode: hit.smtpCode,
      sendResult,
    };
  }

  if (!everConnected) {
    return failedProbe(sendResult, imapTestErrorForAdmin(lastImapError));
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
