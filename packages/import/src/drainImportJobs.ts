/**
 * Claim and run pending AdminJob import_commit rows (Admitto worker).
 */
import type { PrismaClient } from "@admitto/db";
import type { StorageAdapter } from "@admitto/storage";
import { claimNextAdminJob } from "@admitto/tickets";
import {
  executeImportCommit,
  ImportCapacityExceededError,
} from "./executeImportCommit.js";
import {
  parseImportJobStaleRunningMs,
  reclaimStaleImportJobs,
} from "./reclaimStaleImportJobs.js";

export type DrainImportJobsResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  /** Stale `running` jobs marked failed before claiming. */
  reclaimed: number;
  /** Stale `running` jobs healed to succeeded (import already committed). */
  healed: number;
};

type ClaimedImportJob = NonNullable<Awaited<ReturnType<typeof claimNextAdminJob>>>;

function failureMessage(err: unknown): string {
  if (err instanceof ImportCapacityExceededError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

async function markFailed(db: PrismaClient, jobId: string, err: unknown): Promise<void> {
  await db.adminJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      error: failureMessage(err).slice(0, 2000),
      finished_at: new Date(),
    },
  });
}

async function bestEffortDelete(storage: StorageAdapter, key: string): Promise<void> {
  try {
    await storage.delete(key);
  } catch {
    /* best-effort */
  }
}

/** Run one claimed import_commit job to terminal status. */
async function processImportJob(
  db: PrismaClient,
  storage: StorageAdapter,
  job: ClaimedImportJob,
): Promise<"succeeded" | "failed"> {
  try {
    if (!job.event_id || !job.storage_key || !job.import_id) {
      throw new Error("import_job_incomplete");
    }
    const bytes = await storage.get(job.storage_key);
    const csv = bytes.toString("utf8");
    await executeImportCommit(db, {
      eventId: job.event_id,
      csv,
      overwrite: job.overwrite,
      forceCapacity: job.force_capacity,
      actorUserId: job.actor_user_id,
      sessionId: job.session_id,
      timezone: job.client_timezone,
      filename: job.filename,
      importId: job.import_id,
      adminJobId: job.id,
    });
    // Succeeded status is committed inside executeImportCommit when adminJobId is set.
    await bestEffortDelete(storage, job.storage_key);
    return "succeeded";
  } catch (err) {
    await markFailed(db, job.id, err);
    return "failed";
  }
}

/**
 * Process up to `limit` pending import_commit jobs. Caller holds worker `import` lock.
 * Reclaims stale `running` rows first (abandoned after worker crash).
 */
export async function drainImportJobs(
  db: PrismaClient,
  storage: StorageAdapter,
  options: { limit?: number; staleRunningMs?: number } = {},
): Promise<DrainImportJobsResult> {
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : 1;
  const staleRunningMs = options.staleRunningMs ?? parseImportJobStaleRunningMs();
  const { reclaimed, healed } = await reclaimStaleImportJobs(db, storage, {
    olderThanMs: staleRunningMs,
  });

  let claimed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextAdminJob(db, "import_commit");
    if (!job) break;
    claimed += 1;
    const outcome = await processImportJob(db, storage, job);
    if (outcome === "succeeded") succeeded += 1;
    else failed += 1;
  }

  return { claimed, succeeded, failed, reclaimed, healed };
}
