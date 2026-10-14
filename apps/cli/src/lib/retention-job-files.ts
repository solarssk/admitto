import type { PrismaClient } from "@admitto/db";
import {
  getDefaultStorage,
  purgeJobFiles,
  resolveExportFileRetentionDays,
  resolveStagedImportRetentionDays,
  sweepOrphanedJobFiles,
  type PurgeJobFilesResult,
  type StorageAdapter,
} from "@admitto/storage";

/** What one retention pass over the job files did: the purge of finished jobs' files, and the sweep of files no job names. */
export type JobFilesRetentionResult = PurgeJobFilesResult & {
  /** Files in storage that no job named, deleted (in a dry run, that would be). */
  readonly orphanedFiles: number;
};

/**
 * The sweep of files no job names (see sweepOrphanedJobFiles). A sweep that breaks (the upload directory cannot
 * be read, say) counts as one failure and does not throw: the retention steps behind it, the wallet passes of
 * erased attendees among them, still run.
 */
async function sweepOrphanedFiles(
  db: PrismaClient,
  storage: StorageAdapter,
  dryRun: boolean,
): Promise<{ deleted: number; failed: number }> {
  try {
    return await sweepOrphanedJobFiles(db, storage, { dryRun });
  } catch (err) {
    console.error("orphaned job file sweep failed:", err);
    return { deleted: 0, failed: 1 };
  }
}

/**
 * The retention pass over the files that export and import jobs leave in storage (see purgeJobFiles), with the
 * windows from `EXPORT_FILE_RETENTION_DAYS` and `IMPORT_STAGED_FILE_RETENTION_DAYS`, followed by the sweep of
 * files that no job names (a process killed while writing one). Shared by the worker's scheduled retention job
 * and `admitto retention run`, so the two cannot drift.
 */
export async function purgeJobFilesForRetention(db: PrismaClient, dryRun: boolean): Promise<JobFilesRetentionResult> {
  const storage = getDefaultStorage();
  const purged = await purgeJobFiles(db, storage, {
    dryRun,
    exportRetentionDays: resolveExportFileRetentionDays(process.env),
    stagedImportRetentionDays: resolveStagedImportRetentionDays(process.env),
  });
  const swept = await sweepOrphanedFiles(db, storage, dryRun);
  return { ...purged, orphanedFiles: swept.deleted, failures: purged.failures + swept.failed };
}
