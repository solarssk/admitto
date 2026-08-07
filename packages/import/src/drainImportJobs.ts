/**
 * Claim and run pending AdminJob import_commit rows (Admitto worker).
 */
import type { PrismaClient } from "@admitto/db";
import type { StorageAdapter } from "@admitto/storage";
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

async function claimNextImportJob(db: PrismaClient) {
  const pending = await db.adminJob.findFirst({
    where: { type: "import_commit", status: "pending" },
    orderBy: { created_at: "asc" },
  });
  if (!pending) return null;

  const updated = await db.adminJob.updateMany({
    where: { id: pending.id, status: "pending" },
    data: { status: "running", started_at: new Date() },
  });
  if (updated.count === 0) return null;
  return db.adminJob.findUniqueOrThrow({ where: { id: pending.id } });
}

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

async function deleteStagedKey(storage: StorageAdapter, storageKey: string | null): Promise<void> {
  if (!storageKey) return;
  try {
    await storage.delete(storageKey);
  } catch {
    /* best-effort */
  }
}

async function runClaimedImportJob(
  db: PrismaClient,
  storage: StorageAdapter,
  job: {
    id: string;
    event_id: string | null;
    storage_key: string | null;
    import_id: string | null;
    overwrite: boolean;
    force_capacity: boolean;
    actor_user_id: string | null;
    session_id: string | null;
    client_timezone: string | null;
    filename: string | null;
  },
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
    await deleteStagedKey(storage, job.storage_key);
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
    const job = await claimNextImportJob(db);
    if (!job) break;
    claimed += 1;

    const outcome = await runClaimedImportJob(db, storage, job);
    if (outcome === "succeeded") succeeded += 1;
    else failed += 1;
  }

  return { claimed, succeeded, failed, reclaimed, healed };
}
