import type { PrismaClient } from "@admitto/db";
import type { StorageAdapter } from "../types.js";

/**
 * Hours a job file has to be in storage before the sweep may call it unnamed. A file is named a moment after
 * it is written (the export worker records its key on the job, the import enqueue creates the job), and the
 * database cuts a statement off after 30 seconds, so no live job is that far behind. A file whose writer was
 * killed is deleted by the first run after it turns a day old.
 */
export const ORPHANED_JOB_FILE_GRACE_HOURS = 24;

/** Options of {@link sweepOrphanedJobFiles}. */
export type SweepOrphanedJobFilesOptions = {
  readonly dryRun: boolean;
  /** Leave files younger than this many hours alone (default 24). */
  readonly graceHours?: number;
  /** Clock override for tests. */
  readonly nowMs?: number;
};

/** What one {@link sweepOrphanedJobFiles} run found. */
export type SweepOrphanedJobFilesResult = {
  /** Job files in storage. */
  readonly scanned: number;
  /** Files that a job row names: not orphans, never touched. */
  readonly named: number;
  /** Files that no job names but that are younger than the grace window: left for a later run. */
  readonly tooNew: number;
  /** Orphans deleted (in a dry run, that would be). */
  readonly deleted: number;
  /** Orphans that could not be deleted; the next run tries again. */
  readonly failed: number;
};

function graceMsOf(graceHours: number | undefined): number {
  const hours =
    graceHours !== undefined && Number.isFinite(graceHours) && graceHours >= 0 ? graceHours : ORPHANED_JOB_FILE_GRACE_HOURS;
  return hours * 60 * 60 * 1000;
}

/** Every key that an AdminJob row names. */
async function namedJobFileKeys(db: PrismaClient): Promise<Set<string>> {
  const rows = await db.adminJob.findMany({ where: { storage_key: { not: null } }, select: { storage_key: true } });
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.storage_key !== null) keys.add(row.storage_key);
  }
  return keys;
}

/**
 * Delete one unnamed file. The key is looked up again right before the delete, which is what makes the sweep
 * fail closed: a job that was given the key after the read at the start keeps its file.
 */
async function removeIfUnnamed(
  db: PrismaClient,
  storage: StorageAdapter,
  key: string,
  dryRun: boolean,
): Promise<"named" | "deleted" | "gone" | "failed"> {
  if ((await db.adminJob.findFirst({ where: { storage_key: key }, select: { id: true } })) !== null) return "named";
  if (dryRun) return "deleted";
  try {
    return (await storage.delete(key)).deleted ? "deleted" : "gone";
  } catch {
    return "failed";
  }
}

/**
 * Delete (or, with `dryRun`, count) the files that export and import jobs left in storage and that no job
 * names. A job file is named by the `storage_key` of its AdminJob row, and the purge of finished jobs, the
 * purge after an erasure and the deletion of an event all find files only through a row. A process killed
 * between writing a file and recording its key (an export before its key is on the job, the staged CSV of an
 * import before its job exists) leaves one that none of them can reach, and so does a delete that failed after
 * the row was gone. This is what reaches them.
 *
 * Only files in the job layout (`isJobFileKey`) that are older than the grace window are candidates, and a
 * file that a job names is never one, whatever the job's status or age: the retention purge owns those. A file
 * deleted here that was about to be named anyway ends as a job whose file is gone, which a download answers
 * with `not_ready`, an import fails on cleanly, and the purge counts as already deleted.
 */
export async function sweepOrphanedJobFiles(
  db: PrismaClient,
  storage: StorageAdapter,
  options: SweepOrphanedJobFilesOptions,
): Promise<SweepOrphanedJobFilesResult> {
  const graceMs = graceMsOf(options.graceHours);
  const nowMs = options.nowMs ?? Date.now();
  // Read before the listing: a file written after this read is younger than the grace window.
  const named = await namedJobFileKeys(db);

  const counts = { scanned: 0, named: 0, tooNew: 0, deleted: 0, failed: 0 };
  for await (const entry of storage.listJobFiles()) {
    counts.scanned += 1;
    if (named.has(entry.key)) {
      counts.named += 1;
    } else if (nowMs - entry.mtimeMs < graceMs) {
      counts.tooNew += 1;
    } else {
      const outcome = await removeIfUnnamed(db, storage, entry.key, options.dryRun); // NOSONAR - one file at a time on purpose: a sweep must not burst the disk or the database pool
      if (outcome === "named") counts.named += 1;
      else if (outcome === "deleted") counts.deleted += 1;
      else if (outcome === "failed") counts.failed += 1;
    }
  }
  return counts;
}
