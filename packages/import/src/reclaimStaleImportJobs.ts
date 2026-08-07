/**
 * Fail import_commit AdminJobs left in `running` (or never claimed `pending`) after a
 * worker crash/kill/outage.
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
 *
 * Stale `pending` rows (never claimed) are failed on `created_at` so the client
 * poll clock (anchored on created_at until claim) and server reclaim stay aligned.
 */
import type { PrismaClient } from "@admitto/db";
import type { StorageAdapter } from "@admitto/storage";

/** Default: 15 minutes. Keep in sync with admin import poll stale window. */
export const DEFAULT_IMPORT_JOB_STALE_RUNNING_MS = 15 * 60 * 1000;

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

/**
 * Mark stale pending/running import_commit jobs failed (or heal to succeeded when import
 * landed) and delete staged CSV (best-effort). Caller should hold the worker `import` lock.
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
      OR: [
        { status: "running", started_at: { lt: cutoff } },
        { status: "pending", created_at: { lt: cutoff } },
      ],
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
      const updated = await db.adminJob.updateMany({
        where: { id: job.id, status: "pending" },
        data: {
          status: "failed",
          error: STALE_IMPORT_PENDING_ERROR.slice(0, 2000),
          finished_at: now,
        },
      });
      if (updated.count === 0) continue;
      await deleteStagedKey(storage, job.storage_key);
      reclaimed += 1;
      continue;
    }

    const audit =
      job.event_id && job.import_id
        ? await loadImportAuditForHeal(db, job.event_id, job.import_id)
        : null;
    const landed = audit != null;
    const resultJson =
      landed && job.import_id
        ? importResultJsonFromAuditMetadata(job.import_id, audit.metadata)
        : null;
    let updated: { count: number };
    if (landed) {
      updated = await db.adminJob.updateMany({
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
      });
    } else {
      updated = await db.adminJob.updateMany({
        where: { id: job.id, status: "running" },
        data: {
          status: "failed",
          error: STALE_IMPORT_JOB_ERROR.slice(0, 2000),
          finished_at: now,
        },
      });
    }
    if (updated.count === 0) continue;
    await deleteStagedKey(storage, job.storage_key);
    if (landed) healed += 1;
    else reclaimed += 1;
  }

  return { reclaimed, healed };
}
