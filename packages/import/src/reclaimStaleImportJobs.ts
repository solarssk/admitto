/**
 * Fail import_commit AdminJobs left in `running` after a worker crash/kill/outage,
 * and never-claimed `pending` jobs only when the worker heartbeat is already stale
 * (dead/outage). A live worker with a backlog must not fail aged `pending` rows:
 * drain only claims one job per tick, so a burst can legitimately wait longer than
 * the running stale window without meaning the worker is gone.
 *
 * Claim has no lease: if the process dies after `pending` → `running`, the row
 * stays running forever and the UI polls until timeout. Prefer fail (not
 * re-queue): a mid-commit crash may leave partial DB work; safe recovery is
 * operator re-upload.
 *
 * When the import transaction already committed (`attendees_imported` audit with
 * matching importId) but the worker died before clearing `running`, mark the job
 * succeeded and rebuild `result_json` from the audit row so a still-polling client
 * gets a real result instead of "Import finished without a result."
 */
import {
  DEFAULT_WORKER_HEARTBEAT_STALE_MS,
  isWorkerHeartbeatStale,
  positiveMsOr,
  staleAdminJobOrClauses,
  WORKER_HEARTBEAT_ID,
} from "@admitto/db";
import type { PrismaClient } from "@admitto/db";
import type { StorageAdapter } from "@admitto/storage";

/** Default: 15 minutes. Keep in sync with admin import poll stale window (running). */
export const DEFAULT_IMPORT_JOB_STALE_RUNNING_MS = 15 * 60 * 1000;

/** @deprecated Prefer `DEFAULT_WORKER_HEARTBEAT_STALE_MS` from `@admitto/db`. */
export const DEFAULT_IMPORT_PENDING_HEARTBEAT_STALE_MS = DEFAULT_WORKER_HEARTBEAT_STALE_MS;

export { WORKER_HEARTBEAT_ID, isWorkerHeartbeatStale as isWorkerHeartbeatStaleForPendingReclaim };

export const STALE_IMPORT_JOB_ERROR =
  "Import job abandoned (worker stopped while running). Upload the file again.";

export const STALE_IMPORT_PENDING_ERROR =
  "Import job was never picked up by the worker. Start the worker and upload again.";

export type ReclaimStaleImportJobsResult = {
  reclaimed: number;
  /** Stale running jobs whose import already landed; marked succeeded. */
  healed: number;
};

export type ReclaimStaleImportJobsOptions = {
  /** Jobs older than this (started_at when running, created_at when pending) are reclaimed. */
  olderThanMs?: number;
  /**
   * Pending reclaim only when the worker heartbeat is missing or older than this
   * (live backlog must not be failed).
   */
  heartbeatStaleMs?: number;
  /** Clock injection for tests. */
  now?: Date;
};

type StaleImportJobRow = {
  id: string;
  status: string;
  storage_key: string | null;
  event_id: string | null;
  import_id: string | null;
  filename: string | null;
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

function historyNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Minimal ImportCommitDto rebuilt from the attendees_imported audit metadata. */
export function importResultJsonFromAuditMetadata(
  importId: string,
  metadata: unknown,
): Record<string, unknown> {
  const meta =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const created = historyNumber(meta.created);
  const updated = historyNumber(meta.updated);
  const skippedCount = historyNumber(meta.skipped);
  return {
    importId,
    toCreate: created,
    toUpdate: updated,
    toSkip: skippedCount,
    created,
    updated,
    skipped: [],
    skippedCount,
    invalidRows: [],
    invalidCount: 0,
  };
}

async function loadImportAuditForHeal(
  db: PrismaClient,
  eventId: string,
  importId: string,
): Promise<{ metadata: unknown } | null> {
  return db.attendeeActionLog.findFirst({
    where: {
      event_id: eventId,
      action_type: "attendees_imported",
      metadata: { path: ["importId"], equals: importId },
    },
    select: { metadata: true },
  });
}

async function failStalePendingImportJob(
  db: PrismaClient,
  storage: StorageAdapter,
  job: StaleImportJobRow,
  now: Date,
): Promise<boolean> {
  const updated = await db.adminJob.updateMany({
    where: { id: job.id, status: "pending" },
    data: {
      status: "failed",
      error: STALE_IMPORT_PENDING_ERROR.slice(0, 2000),
      finished_at: now,
    },
  });
  if (updated.count === 0) return false;
  await deleteStagedKey(storage, job.storage_key);
  return true;
}

async function reclaimStaleRunningImportJob(
  db: PrismaClient,
  storage: StorageAdapter,
  job: StaleImportJobRow,
  now: Date,
): Promise<"healed" | "reclaimed" | "skipped"> {
  const audit =
    job.event_id && job.import_id
      ? await loadImportAuditForHeal(db, job.event_id, job.import_id)
      : null;
  const landed = audit != null;
  const resultJson =
    landed && job.import_id
      ? importResultJsonFromAuditMetadata(job.import_id, audit.metadata)
      : null;

  const updated = landed
    ? await db.adminJob.updateMany({
        where: { id: job.id, status: "running" },
        data: {
          status: "succeeded",
          error: null,
          finished_at: now,
          created_count: historyNumber(resultJson?.created),
          updated_count: historyNumber(resultJson?.updated),
          skipped_count: historyNumber(resultJson?.skippedCount),
          ...(resultJson ? { result_json: resultJson as object } : {}),
        },
      })
    : await db.adminJob.updateMany({
        where: { id: job.id, status: "running" },
        data: {
          status: "failed",
          error: STALE_IMPORT_JOB_ERROR.slice(0, 2000),
          finished_at: now,
        },
      });

  if (updated.count === 0) return "skipped";
  await deleteStagedKey(storage, job.storage_key);
  return landed ? "healed" : "reclaimed";
}

/**
 * Mark stale running import_commit jobs failed (or heal to succeeded when import
 * landed). Fail aged pending only when the worker heartbeat is stale/missing.
 * Delete staged CSV (best-effort). Caller should hold the worker `import` lock.
 */
export async function reclaimStaleImportJobs(
  db: PrismaClient,
  storage: StorageAdapter,
  options: ReclaimStaleImportJobsOptions = {},
): Promise<ReclaimStaleImportJobsResult> {
  const olderThanMs = positiveMsOr(options.olderThanMs, DEFAULT_IMPORT_JOB_STALE_RUNNING_MS);
  const heartbeatStaleMs = positiveMsOr(
    options.heartbeatStaleMs,
    DEFAULT_WORKER_HEARTBEAT_STALE_MS,
  );
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - olderThanMs);
  const reclaimPending = await isWorkerHeartbeatStale(db, now, heartbeatStaleMs);

  const stale = await db.adminJob.findMany({
    where: {
      type: "import_commit",
      OR: staleAdminJobOrClauses(cutoff, reclaimPending),
    },
    select: {
      id: true,
      status: true,
      storage_key: true,
      event_id: true,
      import_id: true,
      filename: true,
    },
    orderBy: { created_at: "asc" },
  });

  let reclaimed = 0;
  let healed = 0;
  for (const job of stale) {
    if (job.status === "pending") {
      if (await failStalePendingImportJob(db, storage, job, now)) reclaimed += 1;
      continue;
    }
    const outcome = await reclaimStaleRunningImportJob(db, storage, job, now);
    if (outcome === "healed") healed += 1;
    else if (outcome === "reclaimed") reclaimed += 1;
  }

  return { reclaimed, healed };
}
