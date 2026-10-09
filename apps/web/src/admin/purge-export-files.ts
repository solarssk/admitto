import type { PrismaClient } from "@admitto/db";
import { recordSystemLog } from "@admitto/shared/system-log";

/**
 * After an erasure or a removal commits, the export files the event still has in storage hold the people
 * it changed (a copy of the attendee list, written when someone asked for an export). They go at once:
 * an export is cheap to run again, and the person asked to be forgotten. Best effort, like the wallet
 * follow-up: a file that cannot be deleted is reported in the System logs and keeps its job's key, so the
 * retention run (`EXPORT_FILE_RETENTION_DAYS`) deletes it later, and the erasure itself never fails
 * because of it. An export that is still running writes its file after this and is left to the
 * retention run as well.
 */
export async function purgeEventExportFilesBestEffort(db: PrismaClient, eventId: string): Promise<void> {
  try {
    const { getDefaultStorage, purgeEventExportFiles } = await import("@admitto/storage");
    const { failed } = await purgeEventExportFiles(db, getDefaultStorage(), eventId);
    if (failed > 0) {
      recordSystemLog({
        level: "warn",
        source: "admin",
        message: "export_file_purge_incomplete",
        fields: { eventId, failed },
      });
    }
  } catch (err) {
    console.error("export file purge (erasure) failed:", err);
    recordSystemLog({ level: "error", source: "admin", message: "export_file_purge_failed", fields: { eventId } });
  }
}
