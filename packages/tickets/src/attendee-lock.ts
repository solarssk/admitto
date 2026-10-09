import type { PrismaClient } from "@admitto/db";
import { Prisma } from "@admitto/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type LockedAttendee = { id: string; status: string; erased: boolean };

/**
 * Locks an attendee's row against a concurrent erasure until the transaction ends, and says
 * whether it has been erased. Call it first in any transaction that writes a row belonging to the
 * attendee (a check-in, a note, an item state, an activity-log entry, a wallet pass, an email
 * delivery): such an insert only takes the lock a foreign-key check takes, so without this it can
 * wait for a running erasure and then land after it, putting personal data back on a row that was
 * just emptied. A filter on the related row (`attendee: { erased_at: null }`) does not help, it is
 * evaluated against the statement's snapshot and does not see an erasure that commits meanwhile.
 *
 * `FOR KEY SHARE` is the weakest row lock: it blocks only an erasure (which takes `FOR UPDATE`),
 * never an ordinary update of the attendee or another transaction holding the same lock. If an
 * erasure holds the row, this waits for it to commit and then reports the row as erased.
 *
 * Returns null when the attendee does not exist (or belongs to another event, if `eventId` is
 * given). A write that updates the attendee row itself does not need this: put `erased_at: null`
 * in that update's own `where`, which is re-checked against the committed row after the wait.
 */
export async function lockAttendeeRow(
  db: DbClient,
  attendeeId: string,
  eventId?: string,
): Promise<LockedAttendee | null> {
  const rows = await db.$queryRaw<{ id: string; status: string; erased_at: Date | null }[]>`
    SELECT "id", "status", "erased_at" FROM "Attendee"
    WHERE "id" = ${attendeeId}
    ${eventId === undefined ? Prisma.empty : Prisma.sql`AND "event_id" = ${eventId}`}
    FOR KEY SHARE
  `;
  const row = rows[0];
  return row ? { id: row.id, status: row.status, erased: row.erased_at !== null } : null;
}

/**
 * Locks attendee rows `FOR KEY SHARE`, in id order (the order an erasure takes them in), and
 * returns the ids of those that exist and are not erased. For a reader that must see the result of
 * an erasure that is still open before it acts on what it read (a mail about to leave): it waits
 * for the erasure to commit, where a plain read would show the rows as they were before it began.
 * The ids travel as one array parameter, not one parameter each: a statement binds at most 65 535
 * values (past that the server answers with an error about parameter formats), and an export checks
 * as many rows as its cap allows, 50 000.
 */
export async function lockLiveAttendees(
  db: DbClient,
  attendeeIds: readonly string[],
): Promise<Set<string>> {
  if (attendeeIds.length === 0) return new Set();
  const rows = await db.$queryRaw<{ id: string; erased_at: Date | null }[]>`
    SELECT "id", "erased_at" FROM "Attendee"
    WHERE "id" = ANY(${[...new Set(attendeeIds)]}::text[])
    ORDER BY "id" FOR KEY SHARE
  `;
  return new Set(rows.filter((row) => row.erased_at === null).map((row) => row.id));
}

/**
 * Locks attendee rows `FOR UPDATE`, in id order, until the transaction ends. For a transaction
 * that deletes an attendee together with its check-ins, deliveries and wallet pass: it takes the
 * attendee lock first, the same order as an erasure and as every transaction guarded by
 * `lockAttendeeRow`. Without it, deleting the children first and the attendee last can deadlock
 * against a send or a check-in that holds the attendee `FOR KEY SHARE` and then touches a child.
 * Returns the ids that exist in the event.
 */
export async function lockAttendeesForUpdate(
  db: DbClient,
  eventId: string,
  attendeeIds: readonly string[],
): Promise<string[]> {
  if (attendeeIds.length === 0) return [];
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Attendee"
    WHERE "event_id" = ${eventId} AND "id" IN (${Prisma.join([...attendeeIds])})
    ORDER BY "id" FOR UPDATE
  `;
  return rows.map((row) => row.id);
}
