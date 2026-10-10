import type { PrismaClient } from "@admitto/db";
import {
  getDefaultStorage,
  purgeJobFiles,
  resolveExportFileRetentionDays,
  resolveStagedImportRetentionDays,
  type PurgeJobFilesResult,
} from "@admitto/storage";

/**
 * The retention pass over the files that export and import jobs leave in storage (see purgeJobFiles),
 * with the windows from `EXPORT_FILE_RETENTION_DAYS` and `IMPORT_STAGED_FILE_RETENTION_DAYS`. Shared by
 * the worker's scheduled retention job and `admitto retention run`, so the two cannot drift.
 */
export function purgeJobFilesForRetention(db: PrismaClient, dryRun: boolean): Promise<PurgeJobFilesResult> {
  return purgeJobFiles(db, getDefaultStorage(), {
    dryRun,
    exportRetentionDays: resolveExportFileRetentionDays(process.env),
    stagedImportRetentionDays: resolveStagedImportRetentionDays(process.env),
  });
}
