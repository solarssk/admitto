/**
 * Async wallet_push AdminJob HTTP routes - enqueue helper for callers (bulk ticket-type change,
 * eventually event date/location changes), plus poll and history endpoints mirroring the
 * import/export job pattern. See packages/tickets/src/drain-wallet-push-jobs.ts for the worker
 * side.
 */
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import type { WalletPushRequest } from "@admitto/tickets";
import { adminAuditFromContext, assertEventManageAccess, requireEventId, resolveClientTimezone } from "./admin-helpers.js";
import { loadEventAdminJob } from "./admin-job-http.js";

const WALLET_PUSH_HISTORY_LIMIT = 20;

/** Shape written by drainWalletPushJobs (packages/tickets/src/drain-wallet-push-jobs.ts) into
 * AdminJob.result_json once a job finishes - named once so the two response shapes below can't
 * drift apart from the worker's actual payload. */
type WalletPushResultJson = { reissued?: number; skipped?: number; errored?: number } | null;

/** Shared insert behind both enqueue helpers below - the two request kinds differ only in
 * `result_json.request`'s shape, everything else about creating the job row is identical. */
async function createWalletPushJob(
  db: PrismaClient,
  c: Context,
  eventId: string,
  organizationId: string,
  request: WalletPushRequest,
): Promise<string> {
  const audit = adminAuditFromContext(c);
  const job = await db.adminJob.create({
    data: {
      type: "wallet_push",
      status: "pending",
      organization_id: organizationId,
      event_id: eventId,
      actor_user_id: audit.operator ?? null,
      session_id: audit.sessionId ?? null,
      client_timezone: resolveClientTimezone(c),
      result_json: { request },
    },
  });
  return job.id;
}

/** Enqueues a wallet_push job for a caller-resolved set of attendee ids - the job drain re-checks
 * which of them still have an active WalletPass at run time, so a stale/racing id here is simply
 * skipped, never a hard failure. Returns null (no-op) when there's nothing to push, so callers
 * don't create an empty job. */
export async function enqueueWalletPushJob(
  db: PrismaClient,
  c: Context,
  eventId: string,
  organizationId: string,
  attendeeIds: string[],
): Promise<string | null> {
  if (attendeeIds.length === 0) return null;
  return createWalletPushJob(db, c, eventId, organizationId, { kind: "attendee_ids", eventId, attendeeIds });
}

/** Enqueues a wallet_push job for every already-issued active pass under the event - event
 * settings / location saves, where the affected set has no operator-picked selection to bound
 * it. No no-op case to check for here (unlike enqueueWalletPushJob above): the job drain itself
 * resolves the target set at run time, so an event with zero issued passes just finishes with
 * `reissued: 0` rather than never having been worth creating.
 *
 * Deduplicates against any wallet_push job already pending/running for this event instead of
 * creating a new one - unlike enqueueWalletPushJob above (an explicit operator click), this is
 * triggered automatically on every qualifying settings/location save, so a rapid string of saves
 * (or a scripted no-op resubmit loop, since neither caller diffs the new value against the
 * existing one before calling this) must not each queue their own job and starve other events'
 * wallet_push jobs behind it (bot review). The worker re-reads current data when it picks a job
 * up, so an already-queued job still covers a change that lands before it starts running; a
 * change that lands after it started is simply picked up by the next qualifying save, the same
 * self-heals-on-next-save tradeoff already accepted throughout this feature. */
export async function enqueueEventWideWalletPushJob(
  db: PrismaClient,
  c: Context,
  eventId: string,
  organizationId: string,
): Promise<string> {
  const alreadyQueued = await db.adminJob.findFirst({
    where: { event_id: eventId, type: "wallet_push", status: { in: ["pending", "running"] } },
    select: { id: true },
  });
  if (alreadyQueued) return alreadyQueued.id;

  return createWalletPushJob(db, c, eventId, organizationId, { kind: "event_wide", eventId });
}

/** GET /api/admin/events/:eventId/wallet-push/jobs/:jobId */
export async function handleGetWalletPushJob(c: Context, db: PrismaClient): Promise<Response> {
  const loaded = await loadEventAdminJob(c, db, "wallet_push");
  if (loaded instanceof Response) return loaded;
  const { job } = loaded;

  const result = (job.result_json ?? null) as WalletPushResultJson;

  c.header("Cache-Control", "no-store");
  return c.json({
    jobId: job.id,
    status: job.status,
    error: job.error,
    progressTotal: job.progress_total,
    progressDone: job.progress_done,
    reissued: result?.reissued ?? null,
    skipped: result?.skipped ?? null,
    errored: result?.errored ?? null,
    created_at: job.created_at.toISOString(),
    started_at: job.started_at ? job.started_at.toISOString() : null,
  });
}

/** GET /api/admin/events/:eventId/wallet-push/history - recent terminal wallet_push jobs. */
export async function handleGetWalletPushHistory(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const jobs = await db.adminJob.findMany({
    where: { event_id: eventId, type: "wallet_push", status: { in: ["succeeded", "failed"] } },
    orderBy: { finished_at: "desc" },
    take: WALLET_PUSH_HISTORY_LIMIT,
    select: { id: true, created_at: true, finished_at: true, status: true, error: true, result_json: true },
  });

  const items = jobs.map((job) => {
    const result = (job.result_json ?? null) as WalletPushResultJson;
    const when = job.finished_at ?? job.created_at;
    return {
      id: job.id,
      created_at: when.toISOString(),
      reissued: result?.reissued ?? 0,
      skipped: result?.skipped ?? 0,
      errored: result?.errored ?? 0,
      status: job.status === "failed" ? ("failed" as const) : ("succeeded" as const),
      error: job.status === "failed" ? job.error : null,
    };
  });

  c.header("Cache-Control", "no-store");
  return c.json({ items });
}
