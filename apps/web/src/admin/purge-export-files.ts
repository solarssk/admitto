import type { PrismaClient } from "@admitto/db";
import { emitSystemLog, recordSystemLog } from "@admitto/shared/system-log";

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

/**
 * A permanent event deletion removes the event's jobs by cascade, and with them the only record of the
 * files they left in storage (the file of an export, the staged CSV of an import that failed), which hold
 * attendees and which the retention run can no longer find. The deletion reads the keys in the
 * transaction that deletes the rows and calls this after it has committed. Best effort: the deletion
 * never fails because of it, and every file that cannot be deleted is reported with its key (it carries
 * no personal data), because nothing else remembers it: no cap on how many, and on stdout as well as in
 * the System logs (that buffer lives in memory, stdout is what Docker keeps).
 */
export async function deleteEventJobFilesBestEffort(eventId: string, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    const { getDefaultStorage, deleteStoredFiles } = await import("@admitto/storage");
    const { failedKeys } = await deleteStoredFiles(getDefaultStorage(), keys);
    if (failedKeys.length > 0) {
      emitSystemLog("admin", "warn", "event_job_files_purge_incomplete", {
        eventId,
        failed: failedKeys.length,
        keys: failedKeys,
      });
    }
  } catch (err) {
    console.error("event job file purge failed:", err);
    emitSystemLog("admin", "error", "event_job_files_purge_failed", { eventId, keys: [...keys] });
  }
}
