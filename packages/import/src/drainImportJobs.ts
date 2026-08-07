/**
 * Claim and run pending AdminJob import_commit rows (Admitto worker).
 */
import type { PrismaClient } from "@admitto/db";
import type { StorageAdapter } from "@admitto/storage";
import {
  executeImportCommit,
  ImportCapacityExceededError,
  type ExecuteImportCommitResult,
} from "./executeImportCommit.js";

export type DrainImportJobsResult = {
  claimed: number;
  succeeded: number;
  failed: number;
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
    const result = await executeImportCommit(db, {
      eventId: job.event_id,
      csv,
      overwrite: job.overwrite,
      forceCapacity: job.force_capacity,
      actorUserId: job.actor_user_id,
      sessionId: job.session_id,
      timezone: job.client_timezone,
      filename: job.filename,
      importId: job.import_id,
    });
    await markSucceeded(db, job.id, result);
    return "succeeded";
  } catch (err) {
    await markFailed(db, job.id, err);
    return "failed";
  } finally {
    await deleteStagedKey(storage, job.storage_key);
  }
}

/**
 * Process up to `limit` pending import_commit jobs. Caller holds worker `import` lock.
 */
export async function drainImportJobs(
  db: PrismaClient,
  storage: StorageAdapter,
  options: { limit?: number } = {},
): Promise<DrainImportJobsResult> {
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : 1;
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

  return { claimed, succeeded, failed };
}

async function markSucceeded(
  db: PrismaClient,
  jobId: string,
  result: ExecuteImportCommitResult,
): Promise<void> {
  await db.adminJob.update({
    where: { id: jobId },
    data: {
      status: "succeeded",
      finished_at: new Date(),
      to_create: result.toCreate,
      to_update: result.toUpdate,
      to_skip: result.toSkip,
      created_count: result.created,
      updated_count: result.updated,
      skipped_count: result.toSkip,
      invalid_count: result.invalidCount,
      result_json: {
        importId: result.importId,
        toCreate: result.toCreate,
        toUpdate: result.toUpdate,
        toSkip: result.toSkip,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        invalidRows: result.invalidRows,
        invalidCount: result.invalidCount,
      },
      error: null,
    },
  });
}
