/**
 * Fail export AdminJobs left in `running` after a worker crash/kill/outage, and
 * never-claimed `pending` jobs only when the worker heartbeat is already stale
 * (dead/outage). A live worker with a backlog must not fail aged `pending` rows.
 * Mirrors import reclaim (no auto re-queue).
 *
 * Terminal updates scrub raw search text (`q`) from result_json. Stale pending
 * reclaim (heartbeat-gated) still closes the gap where a never-claimed job
 * would otherwise keep `q` forever after a real outage.
 */
import {
  DEFAULT_WORKER_HEARTBEAT_STALE_MS,
  isWorkerHeartbeatStale,
  positiveMsOr,
  staleAdminJobOrClauses,
  WORKER_HEARTBEAT_ID,
} from "@admitto/db";
import type { PrismaClient } from "@admitto/db";
import { scrubExportJobResultJson } from "./export-job-privacy.js";

/** Default: 15 minutes. Align with admin export poll stale window. */
export const DEFAULT_EXPORT_JOB_STALE_RUNNING_MS = 15 * 60 * 1000;

/** @deprecated Prefer `DEFAULT_WORKER_HEARTBEAT_STALE_MS` from `@admitto/db`. */
export const DEFAULT_EXPORT_PENDING_HEARTBEAT_STALE_MS = DEFAULT_WORKER_HEARTBEAT_STALE_MS;

export { WORKER_HEARTBEAT_ID, isWorkerHeartbeatStale as isWorkerHeartbeatStaleForPendingReclaim };

export const STALE_EXPORT_JOB_ERROR =
  "Export job abandoned (worker stopped while running). Start the export again.";

export const STALE_EXPORT_PENDING_ERROR =
  "Export job was never picked up by the worker. Start the worker and export again.";

export type ReclaimStaleExportJobsResult = {
  reclaimed: number;
};

export type ReclaimStaleExportJobsOptions = {
  olderThanMs?: number;
  heartbeatStaleMs?: number;
  now?: Date;
};

export function parseExportJobStaleRunningMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.EXPORT_JOB_STALE_RUNNING_MS?.trim();
  if (!raw) return DEFAULT_EXPORT_JOB_STALE_RUNNING_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_EXPORT_JOB_STALE_RUNNING_MS;
  return n;
}

async function failExportJob(
  db: PrismaClient,
  job: { id: string; status: string; result_json: unknown },
  error: string,
  now: Date,
): Promise<boolean> {
  const scrubbed = scrubExportJobResultJson(job.result_json);
  const updated = await db.adminJob.updateMany({
    where: { id: job.id, status: job.status },
    data: {
      status: "failed",
      error: error.slice(0, 2000),
      finished_at: now,
      ...(scrubbed !== undefined && scrubbed !== null ? { result_json: scrubbed as object } : {}),
    },
  });
  return updated.count > 0;
}

export async function reclaimStaleExportJobs(
  db: PrismaClient,
  options: ReclaimStaleExportJobsOptions = {},
): Promise<ReclaimStaleExportJobsResult> {
  const olderThanMs = positiveMsOr(options.olderThanMs, DEFAULT_EXPORT_JOB_STALE_RUNNING_MS);
  const heartbeatStaleMs = positiveMsOr(
    options.heartbeatStaleMs,
    DEFAULT_WORKER_HEARTBEAT_STALE_MS,
  );
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - olderThanMs);
  const reclaimPending = await isWorkerHeartbeatStale(db, now, heartbeatStaleMs);

  const stale = await db.adminJob.findMany({
    where: {
      type: "export",
      OR: staleAdminJobOrClauses(cutoff, reclaimPending),
    },
    select: { id: true, status: true, result_json: true },
    orderBy: { created_at: "asc" },
  });

  let reclaimed = 0;
  for (const job of stale) {
    const error = job.status === "pending" ? STALE_EXPORT_PENDING_ERROR : STALE_EXPORT_JOB_ERROR;
    if (await failExportJob(db, job, error, now)) reclaimed += 1;
  }
  return { reclaimed };
}
