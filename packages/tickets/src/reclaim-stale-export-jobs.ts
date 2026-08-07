/**
 * Fail export AdminJobs left in `running` after a worker crash/kill.
 * Mirrors import reclaim (no auto re-queue).
 */
import type { PrismaClient } from "@admitto/db";

/** Default: 30 minutes after started_at. */
export const DEFAULT_EXPORT_JOB_STALE_RUNNING_MS = 30 * 60 * 1000;

export const STALE_EXPORT_JOB_ERROR =
  "Export job abandoned (worker stopped while running). Start the export again.";

export type ReclaimStaleExportJobsResult = {
  reclaimed: number;
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

export async function reclaimStaleExportJobs(
  db: PrismaClient,
  options: { olderThanMs?: number; now?: Date } = {},
): Promise<ReclaimStaleExportJobsResult> {
  const olderThanMs =
    options.olderThanMs && options.olderThanMs > 0
      ? Math.floor(options.olderThanMs)
      : DEFAULT_EXPORT_JOB_STALE_RUNNING_MS;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - olderThanMs);

  const stale = await db.adminJob.findMany({
    where: {
      type: "export",
      status: "running",
      started_at: { lt: cutoff },
    },
    select: { id: true },
    orderBy: { started_at: "asc" },
  });

  let reclaimed = 0;
  for (const job of stale) {
    const updated = await db.adminJob.updateMany({
      where: { id: job.id, status: "running" },
      data: {
        status: "failed",
        error: STALE_EXPORT_JOB_ERROR.slice(0, 2000),
        finished_at: now,
      },
    });
    if (updated.count === 0) continue;
    reclaimed += 1;
  }
  return { reclaimed };
}
