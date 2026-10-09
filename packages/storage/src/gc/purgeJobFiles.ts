import type { Prisma, PrismaClient } from "@admitto/db";
import type { StorageAdapter } from "../types.js";

/** Days a finished export keeps its file in storage before the retention run deletes it. */
export const DEFAULT_EXPORT_FILE_RETENTION_DAYS = 7;
/**
 * Days the staged CSV of a finished import job is kept. A commit that works deletes it at once, so what
 * is left is the CSV of a job that failed (or whose cleanup failed): a whole attendee list, with no use.
 */
export const DEFAULT_STAGED_IMPORT_RETENTION_DAYS = 7;

// A fat-fingered override such as 1000000000 would push the cutoff outside the Date range and make
// every query fail before it runs.
const MAX_RETENTION_DAYS = 36_500;
const PAGE_SIZE = 200;

function normalizeDays(days: number | undefined, fallback: number): number {
  if (days === undefined || !Number.isFinite(days) || days < 1) return fallback;
  return Math.min(Math.floor(days), MAX_RETENTION_DAYS);
}

function resolveDays(raw: string | undefined, fallback: number): number {
  const text = raw?.trim();
  if (!text || !/^\d+$/.test(text)) return fallback;
  return normalizeDays(Number(text), fallback);
}

/** Days to keep an export file, from `EXPORT_FILE_RETENTION_DAYS` (default 7). */
export function resolveExportFileRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  return resolveDays(env["EXPORT_FILE_RETENTION_DAYS"], DEFAULT_EXPORT_FILE_RETENTION_DAYS);
}

/** Days to keep the staged CSV of a finished import job, from `IMPORT_STAGED_FILE_RETENTION_DAYS` (default 7). */
export function resolveStagedImportRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  return resolveDays(env["IMPORT_STAGED_FILE_RETENTION_DAYS"], DEFAULT_STAGED_IMPORT_RETENTION_DAYS);
}

/** Counters of one pass over a kind of stored job file. */
type PurgeCounts = { deleted: number; failed: number };

type JobWithFile = { readonly id: string; readonly storage_key: string };

/** The query asks only for jobs that have a file; this is what tells the type system so. */
function hasStoredFile(job: { id: string; storage_key: string | null }): job is JobWithFile {
  return job.storage_key !== null;
}

/** The jobs of `where` that still have a file, after `cursor` (the id of the last job of the page before). */
function jobsWithFile(where: Prisma.AdminJobWhereInput, cursor: string | undefined): Prisma.AdminJobWhereInput {
  return { ...where, storage_key: { not: null }, ...(cursor ? { id: { gt: cursor } } : {}) };
}

/**
 * Delete one job's file and clear the job's key. A file that cannot be deleted keeps its key, so the next
 * run tries again. With `dryRun` nothing is touched.
 */
async function purgeJobFile(
  db: PrismaClient,
  storage: StorageAdapter,
  job: JobWithFile,
  dryRun: boolean,
): Promise<"deleted" | "failed"> {
  if (dryRun) return "deleted";
  try {
    await storage.delete(job.storage_key);
  } catch {
    return "failed";
  }
  // Only the key that was deleted is cleared: a row that was given another one meanwhile keeps it.
  await db.adminJob.updateMany({ where: { id: job.id, storage_key: job.storage_key }, data: { storage_key: null } });
  return "deleted";
}

/**
 * Delete the stored file of every AdminJob matching `where` that still has one, and clear the job's
 * `storage_key`. The job row stays (its counts and filename are history); only the file, which holds
 * attendee data, goes. With `dryRun` it only counts.
 */
async function purgeFilesWhere(
  db: PrismaClient,
  storage: StorageAdapter,
  where: Prisma.AdminJobWhereInput,
  dryRun: boolean,
): Promise<PurgeCounts> {
  const counts: PurgeCounts = { deleted: 0, failed: 0 };
  let cursor: string | undefined;
  for (;;) {
    const page = await db.adminJob.findMany({
      where: jobsWithFile(where, cursor),
      select: { id: true, storage_key: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
    });
    for (const job of page.filter(hasStoredFile)) {
      const outcome = await purgeJobFile(db, storage, job, dryRun);
      if (outcome === "deleted") counts.deleted += 1;
      else counts.failed += 1;
    }
    if (page.length < PAGE_SIZE) return counts;
    // The next page starts after this one, which is what ends the walk when files stay (a failed delete keeps the key).
    cursor = page[page.length - 1]!.id;
  }
}

/** Options of {@link purgeJobFiles}. */
export type PurgeJobFilesOptions = {
  readonly dryRun: boolean;
  /** Clock override for tests. */
  readonly now?: Date;
  /** Days to keep an export file (default 7). */
  readonly exportRetentionDays?: number;
  /** Days to keep a staged import CSV (default 7). */
  readonly stagedImportRetentionDays?: number;
};

/** What one {@link purgeJobFiles} run deleted (or, in a dry run, would delete). */
export type PurgeJobFilesResult = {
  readonly exportFiles: number;
  readonly stagedImportFiles: number;
  /** Files that could not be deleted; their jobs keep the key and are tried again next run. */
  readonly failures: number;
};

function cutoffBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Retention of the files that jobs leave in storage: an export file (a copy of an attendee list, written
 * when someone asks for an export) and the staged CSV of an import job. Both are copies of personal data
 * that nothing else cleans up, and nothing reads them after the job is done. Jobs that have not finished
 * are never touched.
 */
export async function purgeJobFiles(
  db: PrismaClient,
  storage: StorageAdapter,
  options: PurgeJobFilesOptions,
): Promise<PurgeJobFilesResult> {
  const now = options.now ?? new Date();
  const exportCutoff = cutoffBefore(now, normalizeDays(options.exportRetentionDays, DEFAULT_EXPORT_FILE_RETENTION_DAYS));
  const stagedCutoff = cutoffBefore(
    now,
    normalizeDays(options.stagedImportRetentionDays, DEFAULT_STAGED_IMPORT_RETENTION_DAYS),
  );
  const exports = await purgeFilesWhere(db, storage, { type: "export", finished_at: { lte: exportCutoff } }, options.dryRun);
  const staged = await purgeFilesWhere(
    db,
    storage,
    { type: "import_commit", finished_at: { lte: stagedCutoff } },
    options.dryRun,
  );
  return {
    exportFiles: exports.deleted,
    stagedImportFiles: staged.deleted,
    failures: exports.failed + staged.failed,
  };
}

/**
 * Delete every export file the event still has, whatever its age. After an erasure or a removal, a file
 * written before it still holds the person; exports are cheap to run again, so they go at once rather
 * than at the end of the retention window. An export that is still running writes its file afterwards
 * and is covered by the retention run.
 */
export async function purgeEventExportFiles(
  db: PrismaClient,
  storage: StorageAdapter,
  eventId: string,
): Promise<{ deleted: number; failed: number }> {
  return purgeFilesWhere(db, storage, { type: "export", event_id: eventId }, false);
}
