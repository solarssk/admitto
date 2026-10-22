import { Prisma } from "@admitto/db/client";

/** The advisory-lock key of an event's registration queue: one expression for every way of taking it. */
const registrationQueueKey = (eventId: string): Prisma.Sql => {
  const lockName = "registration-queue:" + eventId;
  return Prisma.sql`hashtextextended(${lockName}, 0)`;
};

/**
 * The registration queue of an event: an advisory lock on the event, held until the transaction ends, that lets one
 * transaction at a time change the event's guest registrations (`Registration`) and their queued mail
 * (`RegistrationMail`). A transaction takes it again without harm: Postgres counts the holds of one transaction.
 *
 * Who takes it:
 * - an erasure and a removal of attendees, right after the job locks (eraseAttendees, removeAttendees), because they
 *   delete the registrations of the people (scrubAttendeeTraces takes it again before that delete, only so that the
 *   delete never runs without it: a caller still takes it first);
 * - the permanent deletion of an event, before it locks the event row (the registrations go with the event);
 * - every transaction that inserts, changes or deletes a registration or its mail: a submission, a confirmation, an
 *   admission or a rejection, a deletion by staff, the clean-up of expired ones, and the last check before a
 *   registration mail is sent (a short transaction of its own, never held across the send);
 * - not the write of a send's result: one conditional update of the mail's own row, after the send, which waits for
 *   nothing else and finds no row when the registration went meanwhile.
 *
 * A transaction that takes several of these locks takes them in this order. A step it does not need is skipped,
 * never taken later:
 * 1. the attendee job queue of the event (lockAttendeeJobQueue; an event deletion takes lockEventForScopedWrite
 *    before it);
 * 2. the rows of the event's open export and import jobs (lockOpenAttendeeJobs; an import holds its own job row);
 * 3. the ticket-type catalog of the event (acquireEventTicketTypesLock);
 * 4. the capacity of the event (acquireEventCapacityLock);
 * 5. this lock (in runEventCapacityTransaction, take the registration queue at the start of `work`, never in
 *    `prepare`, which runs before the capacity lock);
 * 6. rows: the event row (an event deletion), registrations before their mail, attendees in id order (lockAttendeeRow,
 *    lockAttendeesForUpdate), and what belongs to an attendee (deliveries, the wallet pass, check-ins).
 * The rows of finished export and import jobs that an erasure or a removal updates at its end (invalidateEventExports,
 * scrubImportJobResults) come after its attendees. Their other writers are single statements, or an event deletion,
 * which takes the job queue exclusively first, as the erasure does.
 *
 * Why one lock for the whole event and not row locks on the registrations of an address: an erasure finds the
 * registrations of a person by the addresses on their attendee row, which it can only trust once it holds that row
 * (an edit can change the address until then), while an admission locks a registration and then writes an attendee.
 * Rows taken in those two orders deadlock (for an action under the GDPR, a server error). Under this lock no two such
 * transactions of an event run at once, so where the registrations come among the rows of step 6 does not matter.
 * Taken after an event, attendee or registration row (step 6), it can wait for an erasure that waits for that row:
 * take it before any of them. So the clean-up of expired registrations reads the events that have some with a plain
 * query, and then, one transaction per event, takes this lock and deletes them with the expiry checked again (a
 * transaction that covers several events takes their locks in the order of their ids).
 */
export async function lockRegistrationQueue(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${registrationQueueKey(eventId)})`);
}

/**
 * Takes the registration queue of the event (see lockRegistrationQueue, whose order it keeps) only when nobody holds it,
 * without waiting, and says whether it did. For a request that must not hold a pooled connection while it waits (a
 * guest's submission): on false it ends its transaction and tries again later.
 */
export async function tryLockRegistrationQueue(tx: Prisma.TransactionClient, eventId: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ locked: boolean }[]>(
    Prisma.sql`SELECT pg_try_advisory_xact_lock(${registrationQueueKey(eventId)}) AS "locked"`,
  );
  return row?.locked === true;
}

/** The columns of a registration that a decision reads (admission, rejection, confirmation of the address). */
const LOCKED_REGISTRATION_SELECT = {
  id: true,
  status: true,
  email: true,
  first_name: true,
  last_name: true,
  company: true,
  department: true,
  custom_data: true,
  companions: true,
  confirm_expires_at: true,
  attendee_id: true,
} satisfies Prisma.RegistrationSelect;

export type LockedRegistration = Prisma.RegistrationGetPayload<{ select: typeof LOCKED_REGISTRATION_SELECT }>;

/**
 * Locks registration rows `FOR UPDATE`, in id order (step 6 of the order in lockRegistrationQueue: after the
 * registration queue, so a caller holds that first), until the transaction ends, and returns them as they are
 * now, in id order. An id that does not exist, or belongs to another event, is not among them. For a transaction
 * that changes the rows it names: whatever another transaction decided about one of them has committed by then
 * (the queue is held), and the row cannot change under this one.
 */
export async function lockRegistrationsForUpdate(
  tx: Prisma.TransactionClient,
  eventId: string,
  ids: readonly string[],
): Promise<LockedRegistration[]> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Registration"
    WHERE "event_id" = ${eventId} AND "id" = ANY(${[...new Set(ids)]}::text[])
    ORDER BY "id"
    FOR UPDATE
  `;
  return tx.registration.findMany({
    where: { id: { in: locked.map((row) => row.id) } },
    select: LOCKED_REGISTRATION_SELECT,
    orderBy: { id: "asc" },
  });
}
