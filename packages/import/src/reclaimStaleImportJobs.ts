/**
 * Fail import_commit AdminJobs left in `running` after a worker crash/kill.
 *
 * Claim has no lease: if the process dies after `pending` → `running`, the row
 * stays running forever and the UI polls until timeout. Prefer fail (not
 * re-queue): a mid-commit crash may leave partial DB work; safe recovery is
 * operator re-upload.
 *
 * When the import transaction already committed (`attendees_imported` audit with
 * matching importId) but the worker died before clearing `running`, mark the job
 * succeeded instead of failed so operators are not told to re-upload duplicates.
 */
import type { PrismaClient } from "@admitto/db";
import type { StorageAdapter } from "@admitto/storage";

/** Default: 30 minutes after started_at. Override via options / env. */
export const DEFAULT_IMPORT_JOB_STALE_RUNNING_MS = 30 * 60 * 1000;

export const STALE_IMPORT_JOB_ERROR =
  "Import job abandoned (worker stopped while running). Upload the file again.";

export type ReclaimStaleImportJobsResult = {
  reclaimed: number;
  /** Stale running jobs whose import already landed; marked succeeded. */
  healed: number;
};

export type ReclaimStaleImportJobsOptions = {
  /** Jobs with started_at older than this are failed. */
  olderThanMs?: number;
  /** Clock injection for tests. */
  now?: Date;
};

/**
 * Parse `IMPORT_JOB_STALE_RUNNING_MS` (positive integer ms). Invalid/missing → default.
 */
export function parseImportJobStaleRunningMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.IMPORT_JOB_STALE_RUNNING_MS?.trim();
  if (!raw) return DEFAULT_IMPORT_JOB_STALE_RUNNING_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_IMPORT_JOB_STALE_RUNNING_MS;
  return n;
}

async function deleteStagedKey(storage: StorageAdapter, storageKey: string | null): Promise<void> {
  if (!storageKey) return;
  try {
    await storage.delete(storageKey);
  } catch {
    /* best-effort */
  }
}

async function importAlreadyCommitted(
  db: PrismaClient,
  eventId: string | null,
  importId: string | null,
): Promise<boolean> {
  if (!eventId || !importId) return false;
  const row = await db.attendeeActionLog.findFirst({
    where: {
      event_id: eventId,
      action_type: "attendees_imported",
      metadata: { path: ["importId"], equals: importId },
    },
    select: { id: true },
  });
  return row != null;
}

/**
 * Mark stale running import_commit jobs failed (or heal to succeeded when import landed)
 * and delete staged CSV (best-effort). Caller should hold the worker `import` lock.
 */
export async function reclaimStaleImportJobs(
  db: PrismaClient,
  storage: StorageAdapter,
  options: ReclaimStaleImportJobsOptions = {},
): Promise<ReclaimStaleImportJobsResult> {
  const olderThanMs =
    options.olderThanMs && options.olderThanMs > 0
      ? Math.floor(options.olderThanMs)
      : DEFAULT_IMPORT_JOB_STALE_RUNNING_MS;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - olderThanMs);

  const stale = await db.adminJob.findMany({
    where: {
      type: "import_commit",
      status: "running",
      started_at: { lt: cutoff },
    },
    select: { id: true, storage_key: true, event_id: true, import_id: true },
    orderBy: { started_at: "asc" },
  });

  let reclaimed = 0;
  let healed = 0;
  for (const job of stale) {
    const landed = await importAlreadyCommitted(db, job.event_id, job.import_id);
    const updated = await db.adminJob.updateMany({
      where: { id: job.id, status: "running" },
      data: landed
        ? {
            status: "succeeded",
            error: null,
            finished_at: now,
          }
        : {
            status: "failed",
            error: STALE_IMPORT_JOB_ERROR.slice(0, 2000),
            finished_at: now,
          },
    });
    if (updated.count === 0) continue;
    await deleteStagedKey(storage, job.storage_key);
    if (landed) healed += 1;
    else reclaimed += 1;
  }

  return { reclaimed, healed };
}
