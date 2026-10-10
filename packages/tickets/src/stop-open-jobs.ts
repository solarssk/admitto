import type { PrismaClient } from "@admitto/db";
import { Prisma } from "@admitto/db/client";
import { scrubExportJobResultJson } from "./export-job-privacy.js";

/** What an export says when an erasure or a removal stopped it. */
export const EXPORT_STOPPED_BY_ERASURE_ERROR =
  "Export stopped: someone in this event was erased or removed before it finished. Run it again.";

/** What an import says when an erasure or a removal stopped it. */
export const IMPORT_STOPPED_BY_ERASURE_ERROR =
  "Import stopped: someone in this event was erased or removed before it finished. Run the import again, and leave that person out of the file if it lists them.";

/** A job that has not finished: waiting for the worker, or being run by it. */
const OPEN_JOB_STATUSES = ["pending", "running"];

/** The jobs that read the attendee list into a file or write attendees from a file. */
const ATTENDEE_JOB_TYPES = ["export", "import_commit"];

const stoppedError = (type: string): string =>
  type === "import_commit" ? IMPORT_STOPPED_BY_ERASURE_ERROR : EXPORT_STOPPED_BY_ERASURE_ERROR;

/**
 * Serialises the creation of an export or an import job with an erasure or a removal in the same event.
 * An erasure or a removal takes it exclusively, as the first thing its transaction does (eraseAttendees and
 * removeAttendees), a request that creates one of those jobs takes it shared, in the transaction that inserts
 * the job (createUnderAttendeeJobQueueLock), so many requests do not wait for each other. Whichever side comes
 * first, the other waits: a job is either committed before the erasure looks for the jobs it has to stop
 * (stopOpenAttendeeJobs), or created after the erasure has committed.
 *
 * A transaction takes it again without harm: Postgres counts the holds of one transaction.
 */
export async function lockAttendeeJobQueue(
  tx: Prisma.TransactionClient,
  eventId: string,
  mode: "exclusive" | "shared",
): Promise<void> {
  const key = `attendee-job-queue:${eventId}`;
  if (mode === "shared") {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtext(${key}))`);
  } else {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
  }
}

/**
 * Stops the exports and the imports of an event that have not finished, inside the transaction of an
 * erasure or a removal. Both read the list of people, or write people into it, from a state that the
 * erasure is about to change, and neither could undo that afterwards:
 *
 * - An export reads its rows, builds its file, stores it, and only then records the file on its job. An
 *   erasure that commits in between cannot delete the file (no job names it yet), and the worker would
 *   record a file that holds the people the erasure just removed.
 * - An import creates people from a file that was uploaded before the erasure. Once the erasure has
 *   committed, the address of an erased person matches nobody, so the import would create the person
 *   again, with the same data.
 *
 * A job that is still waiting is no safer than one that runs: the worker can claim it and read while this
 * transaction is open, and a read does not see what an open transaction has changed.
 *
 * Closing the jobs in the same transaction as the erasure settles it. The worker claims a job only while it
 * is `pending`, an export records its file only while it is `running`, and an import commits its people only
 * together with the update that marks it `succeeded`, which finds nothing to update on a closed job and so
 * rolls the whole import back. Each is one conditional update, and an update that has to wait for the row
 * this transaction holds checks the row again once this transaction commits and finds it closed. A job that
 * finished before has what it wrote already committed: an export has a key that the purge after the commit
 * finds, an import has its result, which the erasure blanks afterwards. The staged file of a stopped import
 * is deleted by the same purge. The price: an export or an import that had not finished when someone was
 * erased or removed fails, and has to be started again.
 *
 * The queue lock is held before the jobs are looked for (eraseAttendees and removeAttendees take it as their first
 * statement; it is taken again here so that this function is right on its own), so a job that is being created
 * waits and is seen, and a job that is created later waits for this transaction and starts after it. That job is a
 * new one: an export reads the list as it is then, and an import adds back whoever its file lists, because nothing
 * that identifies an erased person is kept.
 *
 * Every such job of the event is stopped, whether or not it concerns the person: telling would mean reading each
 * staged file inside this transaction.
 *
 * The search text of a stopped export is scrubbed like that of any other failed export.
 */
export async function stopOpenAttendeeJobs(tx: Prisma.TransactionClient, eventId: string): Promise<number> {
  await lockAttendeeJobQueue(tx, eventId, "exclusive");
  const open = await tx.adminJob.findMany({
    where: { type: { in: ATTENDEE_JOB_TYPES }, event_id: eventId, status: { in: OPEN_JOB_STATUSES } },
    select: { id: true, type: true, result_json: true },
    // The same order for every erasure that runs at once, so that two of them never wait for each other's rows.
    orderBy: { id: "asc" },
  });
  const stopped = await Promise.all(
    open.map(async (job) => {
      const scrubbed = job.type === "export" ? scrubExportJobResultJson(job.result_json) : undefined;
      const { count } = await tx.adminJob.updateMany({
        where: { id: job.id, status: { in: OPEN_JOB_STATUSES } },
        data: {
          status: "failed",
          finished_at: new Date(),
          error: stoppedError(job.type),
          ...(scrubbed !== undefined && scrubbed !== null ? { result_json: scrubbed } : {}),
        },
      });
      return count;
    }),
  );
  return stopped.reduce((sum, count) => sum + count, 0);
}

/**
 * How long a request that creates an export or an import job may wait for an erasure that is open: the database
 * stops any statement after 30 seconds, so a wait longer than that ends in an error, and the transaction around
 * it has to outlive that, because Prisma's default of 5 seconds would end it first, in the middle of a normal wait.
 */
const JOB_CREATE_TX_OPTIONS = { timeout: 35_000, maxWait: 5_000 };

/**
 * Creates an export or an import job under the queue lock of its event (shared, see `lockAttendeeJobQueue`), in
 * one transaction: while an erasure or a removal is open the job waits for it, so it starts from the list as it
 * is afterwards, and one that is committed before it is stopped by it (`stopOpenAttendeeJobs`).
 */
export function createUnderAttendeeJobQueueLock<T>(
  db: PrismaClient,
  eventId: string,
  create: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await lockAttendeeJobQueue(tx, eventId, "shared");
    return create(tx);
  }, JOB_CREATE_TX_OPTIONS);
}
