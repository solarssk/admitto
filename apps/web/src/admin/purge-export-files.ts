import type { PrismaClient } from "@admitto/db";
import { emitSystemLog, recordSystemLog } from "@admitto/shared/system-log";

/**
 * After an erasure or a removal commits, the job files the event still has in storage hold the people it
 * changed: the export files (a copy of the attendee list, written when someone asked for an export) and the
 * staged CSV of every import that has finished (what is left is the CSV of one that failed). They go at once:
 * an export is cheap to run again, a finished import's CSV has no use, and the person asked to be forgotten.
 * Best effort, like the wallet follow-up: a file that cannot be deleted is reported in the System logs and
 * keeps its job's key, so the retention run (`EXPORT_FILE_RETENTION_DAYS`) deletes it later, and the erasure
 * itself never fails because of it. Only the files of the jobs that existed when the erasure ended its work (their
 * ids are read in its transaction): an export requested a moment after it is not touched. An export or an import
 * that is waiting or running when the erasure runs is
 * stopped by the erasure's own transaction (stopOpenAttendeeJobs), so an export cannot record a file afterwards,
 * an import cannot add the person back, and the staged CSV of a stopped import is a finished job's file by now.
 */
export async function purgeEventJobFilesBestEffort(
  db: PrismaClient,
  eventId: string,
  jobIds: readonly string[],
): Promise<void> {
  try {
    const { getDefaultStorage, purgeEventJobFiles } = await import("@admitto/storage");
    const { failed } = await purgeEventJobFiles(db, getDefaultStorage(), eventId, jobIds);
    if (failed > 0) {
      recordSystemLog({
        level: "warn",
        source: "admin",
        message: "job_file_purge_incomplete",
        fields: { eventId, failed },
      });
    }
  } catch (err) {
    console.error("job file purge (erasure) failed:", err);
    recordSystemLog({ level: "error", source: "admin", message: "job_file_purge_failed", fields: { eventId } });
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
