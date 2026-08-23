import type { PrismaClient } from "@admitto/db";
import {
  DEFAULT_WORKER_HEARTBEAT_STALE_MS,
  isWorkerHeartbeatStale,
  positiveMsOr,
  staleAdminJobOrClauses,
} from "@admitto/db";

export type ReclaimStaleAdminJobsByTypeOptions = {
  olderThanMs?: number;
  heartbeatStaleMs?: number;
  now?: Date;
};

/**
 * Fails AdminJobs of `type` left `running` after a worker crash/kill/outage, and never-claimed
 * `pending` jobs only once the worker heartbeat itself is stale - a live worker with a backlog
 * must not have its aged pending rows failed out from under it.
 *
 * Shared by any drain that needs this exact reclaim shape (currently wallet_message).
 * wallet_push and export predate this helper and keep their own inline copies - not retrofitted
 * here, out of scope for the change that introduced this file.
 */
export async function reclaimStaleAdminJobsByType(
  db: PrismaClient,
  type: string,
  errors: { running: string; pending: string },
  defaultOlderThanMs: number,
  options: ReclaimStaleAdminJobsByTypeOptions = {},
): Promise<{ reclaimed: number }> {
  const olderThanMs = positiveMsOr(options.olderThanMs, defaultOlderThanMs);
  const heartbeatStaleMs = positiveMsOr(options.heartbeatStaleMs, DEFAULT_WORKER_HEARTBEAT_STALE_MS);
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - olderThanMs);
  const reclaimPending = await isWorkerHeartbeatStale(db, now, heartbeatStaleMs);

  const stale = await db.adminJob.findMany({
    where: { type, OR: staleAdminJobOrClauses(cutoff, reclaimPending) },
    select: { id: true, status: true },
    orderBy: { created_at: "asc" },
  });

  let reclaimed = 0;
  for (const job of stale) {
    const error = job.status === "pending" ? errors.pending : errors.running;
    const updated = await db.adminJob.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: "failed", error, finished_at: now },
    });
    if (updated.count > 0) reclaimed += 1;
  }
  return { reclaimed };
}
