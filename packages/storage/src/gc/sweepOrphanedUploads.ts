import type { PrismaClient } from "@admitto/db";
import type { StorageAdapter } from "../types.js";
import {
  collectReferencedUploadKeys,
  isReferencedUploadKey,
} from "./collectReferencedUploadKeys.js";

const DEFAULT_GRACE_HOURS = 48;

/** Options for {@link sweepOrphanedUploads}. */
export type SweepOrphanedUploadsOptions = {
  readonly dryRun: boolean;
  /** Skip objects newer than this many hours (default 48). Protects in-progress crops. */
  readonly graceHours?: number;
  /** Clock override for tests. */
  readonly nowMs?: number;
};

/** Counters from one GC sweep. */
export type SweepOrphanedUploadsResult = {
  readonly dryRun: boolean;
  readonly scanned: number;
  readonly referenced: number;
  readonly tooNew: number;
  readonly deleted: number;
  readonly bytesReclaimed: number;
};

/**
 * Delete (or count, in dry-run) managed upload files that nothing in the DB still references
 * and that are older than the grace window.
 */
export async function sweepOrphanedUploads(
  db: PrismaClient,
  storage: StorageAdapter,
  options: SweepOrphanedUploadsOptions,
): Promise<SweepOrphanedUploadsResult> {
  const dryRun = options.dryRun;
  const graceHours =
    options.graceHours !== undefined && Number.isFinite(options.graceHours) && options.graceHours >= 0
      ? options.graceHours
      : DEFAULT_GRACE_HOURS;
  const nowMs = options.nowMs ?? Date.now();
  const graceMs = graceHours * 60 * 60 * 1000;
  const refs = await collectReferencedUploadKeys(db);

  let scanned = 0;
  let referenced = 0;
  let tooNew = 0;
  let deleted = 0;
  let bytesReclaimed = 0;

  for await (const entry of storage.list()) {
    scanned += 1;
    if (refs.has(entry.key)) {
      referenced += 1;
      continue;
    }
    if (nowMs - entry.mtimeMs < graceMs) {
      tooNew += 1;
      continue;
    }
    // Fail-closed: a save may have referenced this key after the snapshot above.
    if (await isReferencedUploadKey(db, entry.key)) {
      referenced += 1;
      continue;
    }
    if (!dryRun) {
      const result = await storage.delete(entry.key);
      if (!result.deleted) continue;
    }
    deleted += 1;
    bytesReclaimed += entry.sizeBytes;
  }

  return { dryRun, scanned, referenced, tooNew, deleted, bytesReclaimed };
}
