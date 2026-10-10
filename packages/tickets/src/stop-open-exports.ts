import type { Prisma } from "@admitto/db/client";
import { scrubExportJobResultJson } from "./export-job-privacy.js";

/** What the job says when an erasure or a removal stopped it. */
export const EXPORT_STOPPED_BY_ERASURE_ERROR =
  "Export stopped: someone in this event was erased or removed before it finished. Run it again.";

/** An export that has not finished: waiting for the worker, or being built by it. */
const OPEN_EXPORT_STATUSES = ["pending", "running"];

/**
 * Stops the exports of an event that have not finished, inside the transaction of an erasure or a removal.
 *
 * An export reads its rows, builds its file, stores it, and only then records the file on its job. An
 * erasure that commits between the last check of the rows and that record cannot delete the file (no job
 * names it yet), and the worker would then record a file that holds the people the erasure just removed.
 * A waiting export is no safer: the worker can claim it and read its rows while this transaction is still
 * open, and a read does not see what an open transaction has changed.
 *
 * Closing the jobs in the same transaction as the erasure settles both. The worker claims a job only while
 * it is pending and records its file only while it is running, each in one conditional update, so a job
 * closed here is never claimed, and a worker that finishes after this deletes the file it wrote instead
 * (an update that has to wait for the row this transaction holds finds it closed). A worker that recorded
 * its file before this has a key that the purge after the commit finds. The price: an export that was
 * waiting or running when someone was erased or removed fails, and has to be started again.
 *
 * Left open: an export that is created inside this transaction's few milliseconds and claimed, and read,
 * inside the same few. Its file is deleted by the retention run, like any export file.
 *
 * The search text of a closed job is scrubbed like that of any other failed export.
 */
export async function stopOpenExportJobs(tx: Prisma.TransactionClient, eventId: string): Promise<number> {
  const open = await tx.adminJob.findMany({
    where: { type: "export", event_id: eventId, status: { in: OPEN_EXPORT_STATUSES } },
    select: { id: true, result_json: true },
    // The same order for every erasure that runs at once, so that two of them never wait for each other's rows.
    orderBy: { id: "asc" },
  });
  const stopped = await Promise.all(
    open.map(async (job) => {
      const scrubbed = scrubExportJobResultJson(job.result_json);
      const { count } = await tx.adminJob.updateMany({
        where: { id: job.id, status: { in: OPEN_EXPORT_STATUSES } },
        data: {
          status: "failed",
          finished_at: new Date(),
          error: EXPORT_STOPPED_BY_ERASURE_ERROR,
          ...(scrubbed !== undefined && scrubbed !== null ? { result_json: scrubbed } : {}),
        },
      });
      return count;
    }),
  );
  return stopped.reduce((sum, count) => sum + count, 0);
}
