/**
 * Async event-wide wallet clean-up AdminJob HTTP routes (`wallet_void_active`) - enqueue + poll,
 * mirroring wallet-refresh-status-routes.ts. The bulk selection routes cap at
 * WALLET_BULK_SEND_LIMIT (100 attendees) because they run inside the request; these hand the same
 * action for EVERY pass of the event to the worker instead. See
 * packages/tickets/src/drain-wallet-cleanup-jobs.ts for the worker side.
 */
import type { Context } from "hono";
import { Prisma, type PrismaClient } from "@admitto/db";
import { resolveEventWalletProvider, WALLET_CLEANUP_JOB_TYPES, type WalletCleanupJobType } from "@admitto/tickets";
import { adminAuditFromContext, assertEventManageAccess, requireEventId } from "./admin-helpers.js";

type WalletCleanupResultJson = { done?: number; skipped?: number; errored?: number } | null;

/** Finds a pending/running job of this type for the event - every clean-up job is event-wide by
 * construction. Returns its status too: a pending job has not read its targets yet, so it will
 * cover whatever is active when it starts, but a running one works from the snapshot it already
 * took. */
async function findPendingWalletCleanupJob(
  db: PrismaClient,
  eventId: string,
  type: WalletCleanupJobType,
): Promise<{ id: string; status: string } | null> {
  return db.adminJob.findFirst({
    where: { event_id: eventId, type, status: { in: ["pending", "running"] } },
    select: { id: true, status: true },
  });
}

/** Enqueues one event-wide clean-up job. A job that is still pending is reused instead of queueing
 * a second one (same dedup, and the same race handled via the partial unique index + P2002 retry,
 * as enqueueEventWideWalletRefreshStatusJob). A job that is already running is reported as such
 * (`alreadyRunning`) rather than reused: it took its list of passes when it started, so a pass that
 * became active since would be missed while the operator is told their new request finished. */
export async function enqueueEventWideWalletCleanupJob(
  db: PrismaClient,
  c: Context,
  eventId: string,
  organizationId: string,
  type: WalletCleanupJobType,
): Promise<{ jobId: string; alreadyRunning: boolean }> {
  const existing = await findPendingWalletCleanupJob(db, eventId, type);
  if (existing) return { jobId: existing.id, alreadyRunning: existing.status === "running" };

  const audit = adminAuditFromContext(c);
  try {
    const job = await db.adminJob.create({
      data: {
        type,
        status: "pending",
        organization_id: organizationId,
        event_id: eventId,
        actor_user_id: audit.operator ?? null,
        session_id: audit.sessionId ?? null,
        client_timezone: audit.timezone ?? null,
        result_json: { request: { eventId } },
      },
    });
    return { jobId: job.id, alreadyRunning: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await findPendingWalletCleanupJob(db, eventId, type);
      if (winner) return { jobId: winner.id, alreadyRunning: winner.status === "running" };
    }
    throw err;
  }
}

/** Shared body of the clean-up trigger routes: access check, event lookup, "wallet is configured"
 * guard, enqueue. The provider is resolved from the event's credentials alone, not the wallet
 * master switch, and app.ts registers these without guardArchivedEvent: winding passes down after
 * an event has ended (or with Wallet switched off) is exactly what these are for. */
async function triggerEventWideWalletCleanup(
  c: Context,
  db: PrismaClient,
  type: WalletCleanupJobType,
): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const event = await db.event.findUnique({ where: { id: eventId }, select: { organization_id: true } });
  if (!event) return c.json({ error: "not_found" }, 404);

  const provider = await resolveEventWalletProvider(db, eventId, { ignoreWalletEnabled: true });
  if (!provider) return c.json({ error: "wallet_not_configured" }, 409);

  const result = await enqueueEventWideWalletCleanupJob(db, c, eventId, event.organization_id, type);
  c.header("Cache-Control", "no-store");
  if (result.alreadyRunning) return c.json({ error: "wallet_cleanup_already_running", jobId: result.jobId }, 409);
  return c.json({ jobId: result.jobId });
}

/** POST /api/admin/events/:eventId/wallet-void-active - voids every active wallet pass of the
 * event in the background. Requires no attendee selection. */
export async function handleTriggerEventWideWalletVoidActive(c: Context, db: PrismaClient): Promise<Response> {
  return triggerEventWideWalletCleanup(c, db, "wallet_void_active");
}

/** GET /api/admin/events/:eventId/wallet-cleanup/jobs/:jobId - status of either clean-up job type
 * (they share one shape and one polling route). */
export async function handleGetWalletCleanupJob(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const jobId = c.req.param("jobId")?.trim();
  if (!jobId) return c.json({ error: "jobId required" }, 400);

  const job = await db.adminJob.findFirst({
    where: { id: jobId, event_id: eventId, type: { in: [...WALLET_CLEANUP_JOB_TYPES] } },
  });
  if (!job) return c.json({ error: "not_found" }, 404);

  const result = (job.result_json ?? null) as WalletCleanupResultJson;

  c.header("Cache-Control", "no-store");
  return c.json({
    jobId: job.id,
    type: job.type,
    status: job.status,
    error: job.error,
    progressTotal: job.progress_total,
    progressDone: job.progress_done,
    done: result?.done ?? null,
    skipped: result?.skipped ?? null,
    errored: result?.errored ?? null,
    created_at: job.created_at.toISOString(),
    started_at: job.started_at ? job.started_at.toISOString() : null,
  });
}
