/**
 * Drain queued (and optionally retryable-failed) EmailDelivery rows via the mail provider.
 * Used by the Admitto worker `mail_delivery` job (ADR 0042).
 */
import type { PrismaClient } from "@admitto/db";
import { materializeStoredDeliveryMessage } from "@admitto/mail-templates";
import { createMailer, sendBatch, type BatchSummary, type MailerAdapter } from "@admitto/mailer";
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
  /** Distinct event ids touched this tick, for the worker to announce over SSE (ADR 0044). */
  eventIds: string[];
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
  queued_at: Date;
};

const SNAPSHOT_SELECT = {
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
  queued_at: true,
} as const;

const SNAPSHOT_READY = {
  recipient_email: { not: null },
  rendered_subject: { not: null },
  rendered_html: { not: null },
} as const;

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

/**
 * Marks a row failed (retryable, unless attempts are exhausted) - guarded two ways against a row
 * this exact attempt no longer owns. `status: { not: "cancelled" }` stops a concurrent
 * cancelBulkSendBatch() from being undone: every one of this function's callers runs when no
 * send was actually attempted or confirmed (link resolution failed, the mailer itself failed to
 * set up), so an unconditional write here would silently put a cancelled row back in the retry
 * pool, where a later drain tick would actually send an email the operator stopped. `queued_at`
 * matching the value this attempt originally claimed stops a *reclaimed* row from being undone
 * the same way: claimInitialDelivery's reclaim_cancelled path can flip a cancelled row straight
 * back to "queued" (with fresh content, under a new batch) while this exact attempt's send call
 * is still outstanding - `status: { not: "cancelled" }` alone would then match (the row reads
 * "queued", not "cancelled") and overwrite the *new* attempt's row with this stale one's error.
 * queued_at is bumped by every claim/retry/reclaim, so a mismatch means someone else already
 * moved this row on. Returns false (no-op) either way, so callers can count it as skipped rather
 * than failed.
 */
async function markRowFailed(
  prisma: PrismaClient,
  rowId: string,
  queuedAt: Date,
  data: { status: "failed"; retryable: boolean; error: string | undefined; attempted_at: Date; failed_at: Date; attempts: number },
): Promise<boolean> {
  const result = await prisma.emailDelivery.updateMany({
    where: { id: rowId, status: { not: "cancelled" }, queued_at: queuedAt },
    data,
  });
  return result.count > 0;
}

async function markClaimedRowFailed(
  prisma: PrismaClient,
  row: SnapshotRow,
  err: unknown,
): Promise<boolean> {
  const nextAttempts = nextMailDrainAttempts(row.attempts);
  const exhausted = isMailDrainAttemptsExhausted(nextAttempts);
  return markRowFailed(prisma, row.id, row.queued_at, {
    ...deliveryUpdateFromBatchError(err, exhausted),
    attempts: nextAttempts,
  });
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
  const eventFilter = options.eventId ? { event_id: options.eventId } : {};
  const attemptFilter = { attempts: { lt: MAX_MAIL_DRAIN_ATTEMPTS } };

  // Queued first so retryable-failed cannot starve fresh work under a shared take+filter.
  const queued = await prisma.emailDelivery.findMany({
    where: {
      ...eventFilter,
      status: "queued",
      ...attemptFilter,
      ...SNAPSHOT_READY,
    },
    orderBy: { queued_at: "asc" },
    take: limit,
    select: SNAPSHOT_SELECT,
  });

  if (!includeFailed || queued.length >= limit) {
    return queued;
  }

  const remaining = limit - queued.length;
  // Over-fetch so per-row exponential backoff can filter without raw SQL.
  const take = Math.min(remaining * 4, Math.max(remaining, 200));
  const failedCandidates = await prisma.emailDelivery.findMany({
    where: {
      ...eventFilter,
      status: "failed",
      retryable: true,
      ...attemptFilter,
      ...SNAPSHOT_READY,
    },
    orderBy: { queued_at: "asc" },
    take,
    select: SNAPSHOT_SELECT,
  });

  const dueFailed = failedCandidates
    .filter((row) => isMailDrainRetryDue(row, nowMs))
    .slice(0, remaining);
  return [...queued, ...dueFailed];
}

/** Records the outcome of a completed sendBatch call - split out of sendOneFromSnapshot so its
 * own branching (no confirmed result vs. a definitive sent/rejected one, plus the queued_at
 * guard's own count===0 case) nests one level shallower, matching drainEventBatch's earlier
 * extraction for the same reason. */
async function recordSendOutcome(
  prisma: PrismaClient,
  delivery: SnapshotRow,
  summary: BatchSummary,
  nextAttempts: number,
  exhausted: boolean,
): Promise<"sent" | "failed" | "skipped"> {
  const result = summary.results[0];
  if (!result) {
    // No confirmed provider response for this send attempt - same "was anything actually
    // attempted" ambiguity as sendOneFromSnapshot's catch block, so the same guards apply.
    const applied = await markRowFailed(prisma, delivery.id, delivery.queued_at, {
      status: "failed",
      retryable: !exhausted,
      error: sanitizeDeliveryError("empty provider result"),
      attempted_at: new Date(),
      failed_at: new Date(),
      attempts: nextAttempts,
    });
    return applied ? "failed" : "skipped";
  }
  // Guarded on queued_at alone (not status): the provider already gave a definitive answer
  // about this message (sent or rejected) by this point, so a plain cancel with no reclaim
  // (queued_at unchanged) must still record that ground truth over a stale "cancelled" - the
  // email already left (or was rejected) regardless of the cancel. A reclaim in the meantime
  // (claimInitialDelivery's reclaim_cancelled path) bumps queued_at when it puts the row back
  // in the queue under a new batch with fresh content, so the guard fails there and this
  // stale result is dropped instead of clobbering the row the operator just re-sent.
  const update = mapSendResultToDelivery(result);
  const failedLike = update.status === "failed" || update.status === "rejected";
  const applied = await prisma.emailDelivery.updateMany({
    where: { id: delivery.id, queued_at: delivery.queued_at },
    data: {
      ...update,
      provider: result.provider,
      attempts: nextAttempts,
      ...(failedLike && exhausted ? { retryable: false } : {}),
    },
  });
  if (applied.count === 0) {
    return "skipped";
  }
  return result.status === "accepted" || result.status === "sent" ? "sent" : "failed";
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
  } catch (err) {
    const applied = await markClaimedRowFailed(prisma, delivery, err);
    return applied ? "failed" : "skipped";
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

  // Re-check right before the actual send, not just at claim time: candidates are read into
  // memory via a plain SELECT (claimDrainCandidates), so a batch cancelled after this row was
  // claimed but before it reached the front of the sequential loop still shows "queued" in the
  // in-memory snapshot. This is the last point where skipping is possible - once sendBatch is
  // called, the email is out and cannot be recalled.
  const fresh = await prisma.emailDelivery.findUnique({
    where: { id: delivery.id },
    select: { status: true },
  });
  if (fresh?.status === "cancelled") {
    return "skipped";
  }

  try {
    const summary = await sendBatch(mailer, [message]);
    return await recordSendOutcome(prisma, delivery, summary, nextAttempts, exhausted);
  } catch (err) {
    // sendBatch itself threw (e.g. a transport timeout) - ambiguous whether the message went
    // out, same as the empty-result branch above, so this must not resurrect a cancelled row
    // into the retry pool, or clobber one a reclaim has since put back in the queue, either.
    const applied = await markRowFailed(prisma, delivery.id, delivery.queued_at, {
      ...deliveryUpdateFromBatchError(err, exhausted),
      attempts: nextAttempts,
    });
    return applied ? "failed" : "skipped";
  }
}

type EventDrainOutcome = { sent: number; failed: number; skipped: number };

/** Drain one event's share of candidates with its own mailer. Split out of
 * drainPendingDeliveries so each half of the per-event logic (mailer-setup failure vs. the
 * actual send loop) nests one level shallower - the combined version tripped Sonar's cognitive
 * complexity limit once the cancelled-row skip counting doubled the branching here. */
async function drainEventBatch(
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv,
  deps: MailDeliveryDeps,
  eventId: string,
  rows: SnapshotRow[],
  baseUrl: string,
): Promise<EventDrainOutcome> {
  let mailer: MailerAdapter;
  try {
    const mailConfig = await resolveMailConfig(eventId, prisma, env);
    mailer = await createMailer(mailConfig, { exportSink: deps.exportSink });
  } catch (err) {
    let failed = 0;
    let skipped = 0;
    for (const row of rows) {
      const applied = await markClaimedRowFailed(prisma, row, err);
      if (applied) failed += 1;
      else skipped += 1;
    }
    return { sent: 0, failed, skipped };
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
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
  return { sent, failed, skipped };
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
    return { claimed: 0, sent: 0, failed: 0, skipped: 0, eventIds: [] };
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
    const outcome = await drainEventBatch(prisma, env, deps, eventId, rows, baseUrl);
    sent += outcome.sent;
    failed += outcome.failed;
    skipped += outcome.skipped;
  }

  return { claimed: candidates.length, sent, failed, skipped, eventIds: [...byEvent.keys()] };
}
