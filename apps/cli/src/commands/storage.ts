import type { PrismaClient } from "@admitto/db";
import { getDefaultStorage, sweepOrphanedUploads } from "@admitto/storage";
import { writeAdminAuditLog } from "@admitto/tickets";
import { hasFlag } from "../lib/args.js";
import { requireOperatorUserId } from "../lib/audit.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function summarize(result: {
  scanned: number;
  referenced: number;
  tooNew: number;
  deleted: number;
  bytesReclaimed: number;
}): string {
  return (
    `${result.scanned} scanned, ${result.referenced} referenced, ${result.tooNew} too new, ` +
    `${result.deleted} orphan(s), ${formatBytes(result.bytesReclaimed)}`
  );
}

/** Run branding upload orphan GC (`admitto storage gc [--dry-run]`). */
export async function runStorageGc(db: PrismaClient): Promise<void> {
  const dryRun = hasFlag("dry-run");
  const storage = getDefaultStorage();

  if (!dryRun) {
    const actorUserId = await requireOperatorUserId(db);
    const result = await sweepOrphanedUploads(db, storage, { dryRun: false });
    await writeAdminAuditLog(db, {
      actorUserId,
      actionType: "storage_gc_run",
      ip: "127.0.0.1",
      metadata: {
        source: "cli",
        scanned: result.scanned,
        referenced: result.referenced,
        tooNew: result.tooNew,
        deleted: result.deleted,
        bytesReclaimed: result.bytesReclaimed,
      },
    });
    console.log(`Deleted orphan uploads: ${summarize(result)}.`);
    return;
  }

  const result = await sweepOrphanedUploads(db, storage, { dryRun: true });
  console.log(`Would delete orphan uploads: ${summarize(result)}.`);
}
