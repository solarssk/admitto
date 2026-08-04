import type { PrismaClient, BounceIngestSettings } from "@admitto/db";
import { closeMailer, createMailer, isSendSuccess, type SendResult } from "@admitto/mailer";
import { resolveMailConfig } from "@admitto/mailer-config";
import { parseBounceLines } from "./bounceIngest/parseBounceLine.js";
import { ImapInboundProvider } from "./bounceIngest/imapProvider.js";
import {
  lookbackSince,
  parseFolders,
  resolveImapConnectConfig,
} from "./bounceIngest/resolveAuth.js";
import type { InboundMailProvider, ParsedBounceLine } from "./bounceIngest/types.js";
import { sanitizeDeliveryError } from "./sanitizeError.js";
import type { MailDeliveryDeps } from "./send.js";
import { buildEventTransportTestMessage } from "./transportTest.js";

export const BOUNCE_PROBE_TIMEOUT_MS = 90_000;
export const BOUNCE_PROBE_POLL_MS = 5_000;

/** Legacy synthetic profile email used by older bounce probes that created a fake Attendee.
 * Kept only so `cleanupLegacyBounceProbeAttendee` can find and remove those rows. */
export function bounceProbeAttendeeEmail(eventId: string): string {
  const safe = eventId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "event";
  return `bounce-probe+${safe}@admitto.invalid`;
}

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

function buildErrorCode(line: ParsedBounceLine): string {
  return line.enhancedCode ? `${line.smtpCode}/${line.enhancedCode}` : line.smtpCode;
}

function isHardBounce(line: ParsedBounceLine): boolean {
  return line.smtpCode.charAt(0) === "5";
}

/**
 * Remove the obsolete per-event "Bounce probe" attendee (and its EmailDelivery rows) left by
 * older probe builds that recorded a fake guest. New probes never create one (same as a plain
 * Send test email). Best-effort: failures are swallowed so a stuck cleanup cannot block the probe.
 */
export async function cleanupLegacyBounceProbeAttendee(
  db: PrismaClient,
  eventId: string,
): Promise<void> {
  try {
    const email = bounceProbeAttendeeEmail(eventId);
    const attendee = await db.attendee.findUnique({
      where: { event_id_email: { event_id: eventId, email } },
      select: { id: true },
    });
    if (!attendee) return;
    await db.emailDelivery.deleteMany({ where: { attendee_id: attendee.id, event_id: eventId } });
    await db.attendee.deleteMany({ where: { id: attendee.id, event_id: eventId } });
  } catch {
    /* best-effort */
  }
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

/**
 * One IMAP pass: look for a hard (5xx) bounce whose recipient matches `recipientEmail`.
 * Uses the same parseBounceLines path as production ingest, but does not create or update
 * EmailDelivery / Attendee rows (plain Send test also leaves no delivery trail).
 */
async function findHardBounceForRecipient(
  db: PrismaClient,
  params: {
    eventId: string;
    recipientEmail: string;
    createProvider?: (settings: BounceIngestSettings) => Promise<InboundMailProvider>;
    env?: NodeJS.ProcessEnv;
  },
): Promise<{ smtpCode: string; reason: string } | null> {
  const settings = await db.bounceIngestSettings.findUnique({
    where: { event_id: params.eventId },
  });
  if (!settings?.imap_host || !settings.enabled) return null;

  const env = params.env ?? process.env;
  let provider: InboundMailProvider;
  if (params.createProvider) {
    provider = await params.createProvider(settings);
  } else {
    const connectCfg = await resolveImapConnectConfig(db, settings, env);
    provider = new ImapInboundProvider(connectCfg);
  }

  const want = params.recipientEmail.trim().toLowerCase();
  try {
    await provider.connect();
    const folders = parseFolders(settings.folders);
    const since = lookbackSince();

    for (const folder of folders) {
      const messages = await provider.fetchCandidateMessages(folder, since);
      for (const message of messages) {
        if (await isUidProcessed(db, params.eventId, folder, message.uid)) continue;

        const lines = parseBounceLines(message.bodyText);
        const hit = lines.find(
          (line) => line.recipientEmail.trim().toLowerCase() === want && isHardBounce(line),
        );
        if (!hit) continue;

        await markUidProcessed(db, params.eventId, folder, message.uid);
        if (provider.markSeen) {
          try {
            await provider.markSeen(folder, message.uid);
          } catch {
            /* optional */
          }
        }
        return { smtpCode: buildErrorCode(hit), reason: hit.reason };
      }
    }
  } finally {
    try {
      await provider.close();
    } catch {
      /* ignore */
    }
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

  await cleanupLegacyBounceProbeAttendee(db, eventId);

  const mailConfig = await resolveMailConfig(eventId, db, env);
  const { subject, html } = await buildEventTransportTestMessage(eventId, db, env, {
    provider: mailConfig.provider,
    toAddress,
    mailConfig,
  });

  const mailer = await createMailer(mailConfig, { exportSink: deps.exportSink });
  let sendResult: SendResult;
  try {
    sendResult = await mailer.send({
      to: toAddress,
      subject,
      html,
    });
    if (sendResult.error) {
      sendResult = { ...sendResult, error: sanitizeDeliveryError(sendResult.error) };
    }
  } finally {
    await closeMailer(mailer);
  }

  if (!isSendSuccess(sendResult.status) || sendResult.error) {
    return {
      status: "failed",
      message: sendResult.error ?? "Send failed before bounce wait.",
      sendResult,
    };
  }

  const recipient = toAddress.trim().toLowerCase();
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const hit = await findHardBounceForRecipient(db, {
      eventId,
      recipientEmail: recipient,
      createProvider: ingestOptions.createProvider,
      env: ingestOptions.env ?? env,
    });
    if (hit) {
      return {
        status: "ok",
        message: `Bounce received (${hit.smtpCode}). Detection can read delivery failures from the bounce mailbox.`,
        smtpCode: hit.smtpCode,
        sendResult,
      };
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollMs, remaining));
  }

  return {
    status: "timeout",
    message:
      "Mail was accepted by the transport, but no matching bounce appeared in IMAP within 90 seconds. Check the bounce folder, forward rule, and try again.",
    sendResult,
  };
}

export class BounceProbeSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BounceProbeSetupError";
  }
}
