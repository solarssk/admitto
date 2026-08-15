/**
 * Async wallet_push AdminJob HTTP routes - enqueue helper for callers (bulk ticket-type change,
 * eventually event date/location changes), plus poll and history endpoints mirroring the
 * import/export job pattern. See packages/tickets/src/drain-wallet-push-jobs.ts for the worker
 * side.
 */
import type { Context } from "hono";
import { Prisma, type PrismaClient } from "@admitto/db";
import { readWalletPushRequest, type WalletPushRequest } from "@admitto/tickets";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  positiveIntQuery,
  requireEventId,
  resolveClientTimezone,
} from "./admin-helpers.js";
import { loadEventAdminJob } from "./admin-job-http.js";

const WALLET_PUSH_HISTORY_PAGE_SIZE_DEFAULT = 10;
const WALLET_PUSH_HISTORY_PAGE_SIZE_MAX = 50;

/** Shape written by drainWalletPushJobs (packages/tickets/src/drain-wallet-push-jobs.ts) into
 * AdminJob.result_json once a job finishes - named once so the two response shapes below can't
 * drift apart from the worker's actual payload. The `request` field also stored there is read
 * separately via readWalletPushRequest below (validated), not through this loose cast. */
type WalletPushResultJson = {
  reissued?: number;
  skipped?: number;
  errored?: number;
} | null;

/** Scope shown in the history list - "how many/which attendees" for an operator-bounded push,
 * or "the whole event" plus, when known, which wallet-relevant save triggered it. `null` for
 * jobs created before this field existed, or if result_json.request was somehow never a valid
 * WalletPushRequest - the history row still renders, just without this detail. */
export type WalletPushHistoryScope =
  | { kind: "attendee_ids"; count: number }
  | { kind: "event_wide"; reason: "location" | "settings" | null };

/** Re-validates the stored request via the same parser the drain worker itself trusts
 * (packages/tickets), rather than the loose WalletPushResultJson cast below - a single
 * malformed/unexpected-shape row must degrade to scope: null, not throw and 500 the whole
 * history list. */
function historyScope(job: { result_json: unknown }): WalletPushHistoryScope | null {
  const request = readWalletPushRequest(job);
  if (!request) return null;
  if (request.kind === "attendee_ids") return { kind: "attendee_ids", count: request.attendeeIds.length };
  return { kind: "event_wide", reason: request.reason ?? null };
}

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

/** Finds a pending/running *event_wide* wallet_push job for the event - deliberately scoped to
 * that one request kind (via a JSON-path filter on result_json.request.kind) so an
 * attendee_ids-kind job (e.g. from a bulk ticket-type change, covering only its own selection)
 * never gets mistaken for coverage of an event-wide push and suppresses one that's actually
 * needed (bot review). */
async function findPendingEventWideWalletPushJob(db: PrismaClient, eventId: string): Promise<string | null> {
  const job = await db.adminJob.findFirst({
    where: {
      event_id: eventId,
      type: "wallet_push",
      status: { in: ["pending", "running"] },
      result_json: { path: ["request", "kind"], equals: "event_wide" },
    },
    select: { id: true },
  });
  return job?.id ?? null;
}

/** Enqueues a wallet_push job for every already-issued active pass under the event - event
 * settings / location saves, where the affected set has no operator-picked selection to bound
 * it. No no-op case to check for here (unlike enqueueWalletPushJob above): the job drain itself
 * resolves the target set at run time, so an event with zero issued passes just finishes with
 * `reissued: 0` rather than never having been worth creating.
 *
 * Deduplicates against any pending/running *event_wide* wallet_push job for this event instead
 * of creating a new one - unlike enqueueWalletPushJob above (an explicit operator click), this is
 * triggered automatically on every qualifying settings/location save, so a rapid string of saves
 * must not each queue their own job and starve other events' wallet_push jobs behind it. The
 * worker re-reads current data when it picks a job up, so an already-queued job still covers a
 * change that lands before it starts running; a change that lands after it started is simply
 * picked up by the next qualifying save, the same self-heals-on-next-save tradeoff already
 * accepted throughout this feature.
 *
 * findPendingEventWideWalletPushJob above is a fast-path check only, not the actual guarantee -
 * two concurrent saves can both pass it before either one's create() below commits (bot review).
 * The real invariant is a partial unique index on AdminJob(event_id) scoped to exactly this
 * (type=wallet_push, kind=event_wide, status pending/running) - see the migration named for it.
 * A P2002 from that index means this call lost the race; fetch and return whichever job won it
 * instead of failing the caller's save over what is, from the caller's perspective, already a
 * queued push. */
export async function enqueueEventWideWalletPushJob(
  db: PrismaClient,
  c: Context,
  eventId: string,
  organizationId: string,
  reason?: "location" | "settings",
): Promise<string> {
  const alreadyQueued = await findPendingEventWideWalletPushJob(db, eventId);
  if (alreadyQueued) return alreadyQueued;

  try {
    return await createWalletPushJob(db, c, eventId, organizationId, { kind: "event_wide", eventId, reason });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await findPendingEventWideWalletPushJob(db, eventId);
      if (winner) return winner;
    }
    throw err;
  }
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

/** GET /api/admin/events/:eventId/wallet-push/history - paginated terminal wallet_push jobs,
 * newest first. */
export async function handleGetWalletPushHistory(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const page = positiveIntQuery(c.req.query("page"), 1);
  const pageSize = positiveIntQuery(
    c.req.query("pageSize"),
    WALLET_PUSH_HISTORY_PAGE_SIZE_DEFAULT,
    WALLET_PUSH_HISTORY_PAGE_SIZE_MAX,
  );

  const where = { event_id: eventId, type: "wallet_push", status: { in: ["succeeded", "failed"] } };

  const [jobs, total] = await Promise.all([
    db.adminJob.findMany({
      where,
      orderBy: { finished_at: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        created_at: true,
        finished_at: true,
        status: true,
        error: true,
        result_json: true,
        client_timezone: true,
      },
    }),
    db.adminJob.count({ where }),
  ]);

  const items = jobs.map((job) => {
    const result = (job.result_json ?? null) as WalletPushResultJson;
    const when = job.finished_at ?? job.created_at;
    return {
      id: job.id,
      created_at: when.toISOString(),
      client_timezone: job.client_timezone,
      reissued: result?.reissued ?? 0,
      skipped: result?.skipped ?? 0,
      errored: result?.errored ?? 0,
      status: job.status === "failed" ? ("failed" as const) : ("succeeded" as const),
      error: job.status === "failed" ? job.error : null,
      scope: historyScope(job),
    };
  });

  c.header("Cache-Control", "no-store");
  return c.json({ items, total, page, pageSize });
}
