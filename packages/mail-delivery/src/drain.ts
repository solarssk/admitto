/**
 * Drain queued (and optionally retryable-failed) EmailDelivery rows via the mail provider.
 * Used by the Admitto worker `mail_delivery` job (ADR 0042).
 */
import type { PrismaClient } from "@admitto/db";
import { materializeStoredDeliveryMessage } from "@admitto/mail-templates";
import { createMailer, sendBatch, type MailerAdapter } from "@admitto/mailer";
import { resolveMailConfig } from "@admitto/mailer-config";
import { resolveBaseUrl } from "./baseUrl.js";
import {
  MAX_MAIL_DRAIN_ATTEMPTS,
  isMailDrainAttemptsExhausted,
  isMailDrainRetryDue,
  nextMailDrainAttempts,
} from "./drain-retry.js";
import { resolveAttendeeMailLinks } from "./links.js";
import { mapSendResultToDelivery } from "./mapSendResult.js";
import { sanitizeDeliveryError } from "./sanitizeError.js";
import type { MailDeliveryDeps } from "./send.js";

export const DEFAULT_MAIL_DRAIN_LIMIT = 50;

export interface DrainPendingDeliveriesOptions {
  /** Cap rows claimed this tick (default 50). */
  limit?: number;
  /** When set, only that event's deliveries. */
  eventId?: string;
  /** Include `failed`+`retryable` rows (default true for the worker). */
  includeRetryableFailed?: boolean;
  /** Resolved public instance URL (env BASE_URL or DB instance_url). */
  baseUrl?: string;
  /** Override "now" for backoff tests. */
  nowMs?: number;
}

export interface DrainPendingDeliveriesResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}

type SnapshotRow = {
  id: string;
  event_id: string;
  attendee_id: string;
  purpose: string;
  status: string;
  attempts: number;
  attempted_at: Date | null;
  recipient_email: string | null;
  rendered_subject: string | null;
  rendered_html: string | null;
};

function deliveryUpdateFromBatchError(err: unknown, exhausted: boolean) {
  const now = new Date();
  const message = err instanceof Error ? err.message : String(err);
  return {
    status: "failed" as const,
    retryable: !exhausted,
    error: sanitizeDeliveryError(message),
    attempted_at: now,
    failed_at: now,
  };
}

async function claimDrainCandidates(
  prisma: PrismaClient,
  options: DrainPendingDeliveriesOptions,
): Promise<SnapshotRow[]> {
  const limit =
    typeof options.limit === "number" && options.limit > 0
      ? Math.floor(options.limit)
      : DEFAULT_MAIL_DRAIN_LIMIT;
  const includeFailed = options.includeRetryableFailed !== false;
  const nowMs = options.nowMs ?? Date.now();

  const statusClause = includeFailed
    ? {
        OR: [
          { status: "queued" },
          { AND: [{ status: "failed" }, { retryable: true }] },
        ],
      }
    : { status: "queued" };

  // Over-fetch so per-row exponential backoff can filter without raw SQL.
  const take = includeFailed ? Math.min(limit * 4, Math.max(limit, 200)) : limit;

  const rows = await prisma.emailDelivery.findMany({
    where: {
      ...(options.eventId ? { event_id: options.eventId } : {}),
      AND: [
        statusClause,
        { attempts: { lt: MAX_MAIL_DRAIN_ATTEMPTS } },
        {
          recipient_email: { not: null },
          rendered_subject: { not: null },
          rendered_html: { not: null },
        },
      ],
    },
    orderBy: { queued_at: "asc" },
    take,
    select: {
      id: true,
      event_id: true,
      attendee_id: true,
      purpose: true,
      status: true,
      attempts: true,
      attempted_at: true,
      recipient_email: true,
      rendered_subject: true,
      rendered_html: true,
    },
  });

  const due = rows.filter((row) => isMailDrainRetryDue(row, nowMs));
  return due.slice(0, limit);
}

async function sendOneFromSnapshot(
  delivery: SnapshotRow,
  prisma: PrismaClient,
  mailer: MailerAdapter,
  baseUrl: string,
): Promise<"sent" | "failed" | "skipped"> {
  if (!delivery.recipient_email || !delivery.rendered_subject || !delivery.rendered_html) {
    return "skipped";
  }

  let links;
  try {
    links = await resolveAttendeeMailLinks(delivery.attendee_id, prisma, baseUrl);
  } catch {
    return "skipped";
  }

  const materialized = materializeStoredDeliveryMessage(
    { subject: delivery.rendered_subject, html: delivery.rendered_html },
    links,
  );

  const isRetry = delivery.status === "failed";
  const nextAttempts = nextMailDrainAttempts(delivery.attempts);
  const exhausted = isMailDrainAttemptsExhausted(nextAttempts);
  const message = {
    to: delivery.recipient_email,
    subject: materialized.subject,
    html: materialized.html,
    idempotencyKey: isRetry
      ? `${delivery.attendee_id}:${delivery.purpose}:retry:${delivery.id}`
      : `${delivery.attendee_id}:${delivery.purpose}:${delivery.id}`,
  };

  try {
    const summary = await sendBatch(mailer, [message]);
    const result = summary.results[0];
    if (!result) {
      await prisma.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "failed",
          retryable: !exhausted,
          error: sanitizeDeliveryError("empty provider result"),
          attempted_at: new Date(),
          failed_at: new Date(),
          attempts: nextAttempts,
        },
      });
      return "failed";
    }
    const update = mapSendResultToDelivery(result);
    const failedLike = update.status === "failed" || update.status === "rejected";
    await prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: {
        ...update,
        provider: result.provider,
        attempts: nextAttempts,
        ...(failedLike && exhausted ? { retryable: false } : {}),
      },
    });
    return result.status === "accepted" || result.status === "sent" ? "sent" : "failed";
  } catch (err) {
    await prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: {
        ...deliveryUpdateFromBatchError(err, exhausted),
        attempts: nextAttempts,
      },
    });
    return "failed";
  }
}

/**
 * Claim and send pending EmailDelivery rows. Groups by event so each event gets one mailer.
 * Safe under worker advisory lock `mail_delivery`.
 */
export async function drainPendingDeliveries(
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  deps: MailDeliveryDeps = {},
  options: DrainPendingDeliveriesOptions = {},
): Promise<DrainPendingDeliveriesResult> {
  const candidates = await claimDrainCandidates(prisma, options);
  if (candidates.length === 0) {
    return { claimed: 0, sent: 0, failed: 0, skipped: 0 };
  }

  const baseUrl = options.baseUrl ?? resolveBaseUrl(env);
  const byEvent = new Map<string, SnapshotRow[]>();
  for (const row of candidates) {
    const list = byEvent.get(row.event_id) ?? [];
    list.push(row);
    byEvent.set(row.event_id, list);
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const [eventId, rows] of byEvent) {
    const mailConfig = await resolveMailConfig(eventId, prisma, env);
    const mailer = await createMailer(mailConfig, { exportSink: deps.exportSink });
    try {
      for (const row of rows) {
        const outcome = await sendOneFromSnapshot(row, prisma, mailer, baseUrl);
        if (outcome === "sent") sent += 1;
        else if (outcome === "failed") failed += 1;
        else skipped += 1;
      }
    } finally {
      await mailer.close();
    }
  }

  return { claimed: candidates.length, sent, failed, skipped };
}
