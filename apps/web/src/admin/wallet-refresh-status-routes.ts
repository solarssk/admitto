/**
 * Async wallet_refresh_status AdminJob HTTP routes - enqueue + poll, mirroring wallet-push-
 * routes.ts's own shape. Always event-wide (there's no operator-bounded selection kind - a bulk
 * selection refreshes synchronously instead, see attendees-api-routes.ts's
 * bulk-wallet-refresh-status), so this is simpler than its wallet_push sibling: no `kind`/`reason`
 * to carry, and deliberately no history endpoint for v1 - there's exactly one trigger (the
 * Attendees header's manual "Refresh status" click), unlike wallet_push's several. See
 * packages/tickets/src/drain-wallet-refresh-status-jobs.ts for the worker side.
 */
import type { Context } from "hono";
import { Prisma, type PrismaClient } from "@admitto/db";
import { resolveEventWalletProvider } from "@admitto/tickets";
import { adminAuditFromContext, assertEventManageAccess, requireEventId } from "./admin-helpers.js";
import { loadEventAdminJob } from "./admin-job-http.js";

type WalletRefreshStatusResultJson = {
  refreshed?: number;
  skipped?: number;
  errored?: number;
} | null;

/** Finds a pending/running wallet_refresh_status job for the event - every such job is event-wide
 * by construction, unlike wallet_push's own version of this check, which has to filter on
 * result_json.request.kind to avoid mistaking an attendee_ids-kind job for event-wide coverage. */
async function findPendingWalletRefreshStatusJob(db: PrismaClient, eventId: string): Promise<string | null> {
  const job = await db.adminJob.findFirst({
    where: { event_id: eventId, type: "wallet_refresh_status", status: { in: ["pending", "running"] } },
    select: { id: true },
  });
  return job?.id ?? null;
}

/** Enqueues a wallet_refresh_status job for every wallet pass under the event with a known
 * device-registration id - deduplicates against any pending/running job for this event instead of
 * creating a new one, same reasoning (and same race handled via the partial unique index +
 * P2002 retry) as enqueueEventWideWalletPushJob. */
export async function enqueueEventWideWalletRefreshStatusJob(
  db: PrismaClient,
  c: Context,
  eventId: string,
  organizationId: string,
): Promise<string> {
  const alreadyQueued = await findPendingWalletRefreshStatusJob(db, eventId);
  if (alreadyQueued) return alreadyQueued;

  const audit = adminAuditFromContext(c);
  try {
    const job = await db.adminJob.create({
      data: {
        type: "wallet_refresh_status",
        status: "pending",
        organization_id: organizationId,
        event_id: eventId,
        actor_user_id: audit.operator ?? null,
        session_id: audit.sessionId ?? null,
        result_json: { request: { eventId } },
      },
    });
    return job.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await findPendingWalletRefreshStatusJob(db, eventId);
      if (winner) return winner;
    }
    throw err;
  }
}

/** POST /api/admin/events/:eventId/wallet-refresh-status - manual, operator-triggered event-wide
 * refresh, from the Attendees header's "More actions" menu. Guarded on the event actually having
 * wallet configured, same resolveEventWalletProvider check the manual wallet-push trigger and the
 * bulk wallet-action routes already use. */
export async function handleTriggerEventWideWalletRefreshStatus(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const event = await db.event.findUnique({ where: { id: eventId }, select: { organization_id: true } });
  if (!event) return c.json({ error: "not_found" }, 404);

  const provider = await resolveEventWalletProvider(db, eventId);
  if (!provider) return c.json({ error: "wallet_not_configured" }, 409);

  const jobId = await enqueueEventWideWalletRefreshStatusJob(db, c, eventId, event.organization_id);
  c.header("Cache-Control", "no-store");
  return c.json({ jobId });
}

/** GET /api/admin/events/:eventId/wallet-refresh-status/jobs/:jobId */
export async function handleGetWalletRefreshStatusJob(c: Context, db: PrismaClient): Promise<Response> {
  const loaded = await loadEventAdminJob(c, db, "wallet_refresh_status");
  if (loaded instanceof Response) return loaded;
  const { job } = loaded;

  const result = (job.result_json ?? null) as WalletRefreshStatusResultJson;

  c.header("Cache-Control", "no-store");
  return c.json({
    jobId: job.id,
    status: job.status,
    error: job.error,
    progressTotal: job.progress_total,
    progressDone: job.progress_done,
    refreshed: result?.refreshed ?? null,
    skipped: result?.skipped ?? null,
    errored: result?.errored ?? null,
    created_at: job.created_at.toISOString(),
    started_at: job.started_at ? job.started_at.toISOString() : null,
  });
}
