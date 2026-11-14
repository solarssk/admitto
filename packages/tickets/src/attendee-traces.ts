import { Prisma } from "@admitto/db/client";
import { lockRegistrationQueue } from "./registration-lock.js";
import { stopOpenAttendeeJobs } from "./stop-open-jobs.js";
import { invalidateEventExports } from "./export-job-privacy.js";

export type ScrubAttendeeTracesParams = {
  eventId: string;
  /** The attendees that were erased or removed. */
  attendeeIds: readonly string[];
  /** The addresses those attendees had, lower-cased (empty for attendees that were already anonymous). */
  emails: readonly string[];
};

/** What scrubAttendeeTraces deleted, for the audit entry (counts only). */
export type ScrubAttendeeTracesResult = {
  /** Guest registrations, with their queued mail. */
  registrations: number;
};

/** An attendee about to be erased or removed, as far as collecting their addresses goes. */
export type AttendeeAddressSource = { id: string; email: string };

const normalizedAddress = (value: string): string => value.trim().toLowerCase();

/**
 * The addresses that an edit of an attendee's profile replaced or set, as the attendee's activity log records them
 * (`attendee_edited`, `field_changes.email.from` and `.to`), one row per address and log entry, for the entries that
 * `where` selects (the alias of the log is `log`).
 */
const editedAddresses = (where: Prisma.Sql): Prisma.Sql => Prisma.sql`
  SELECT change."address" FROM "AttendeeActionLog" log
  CROSS JOIN LATERAL (VALUES
    (log."metadata"->'field_changes'->'email'->>'from'),
    (log."metadata"->'field_changes'->'email'->>'to')
  ) AS change("address")
  WHERE log."action_type" = 'attendee_edited' AND change."address" IS NOT NULL AND ${where}
`;

/**
 * The addresses to scrub for attendees that are about to be erased or removed (lower-cased and trimmed): the one
 * each has now, the one their first ticket mail went to, and the ones an edit of their profile replaced or set (their
 * activity log). An attendee whose address was edited has the older one only in that delivery and that log, which the
 * erasure empties or deletes and the removal deletes, so this has to run before either.
 *
 * Only the first mail counts: it always goes to the address on the profile, while a resend can go to any address
 * that staff typed in (a manager's mailbox, say), and that one is not the person's. An older address is also left out
 * when it is not safely theirs alone: another attendee of the event holds it now, or had it before (their first mail
 * went to it, or their log records an edit from or to it). Scrubbing it would blank, and cancel, mail that belongs to
 * somebody else, and delete their registration.
 *
 * Personal data: used in memory within the caller's transaction (scrubAttendeeTraces, scrubImportJobResults),
 * never logged, audited or stored.
 */
export async function collectAttendeeAddresses(
  tx: Prisma.TransactionClient,
  { eventId, attendees }: { eventId: string; attendees: readonly AttendeeAddressSource[] },
): Promise<string[]> {
  const current = [...new Set(attendees.map((attendee) => normalizedAddress(attendee.email)).filter((email) => email.length > 0))];
  if (attendees.length === 0) return current;
  const ids = attendees.map((attendee) => attendee.id);
  const firstMails = await tx.emailDelivery.findMany({
    where: { event_id: eventId, attendee_id: { in: ids }, purpose: "initial", recipient_email: { not: null } },
    select: { recipient_email: true },
    distinct: ["recipient_email"],
  });
  const edits = await tx.$queryRaw<{ address: string }[]>(editedAddresses(Prisma.sql`log."attendee_id" = ANY(${ids}::text[])`));
  const older = [
    ...new Set(
      [...firstMails.map((row) => row.recipient_email), ...edits.map((row) => row.address)]
        .filter((email): email is string => email !== null)
        .map(normalizedAddress),
    ),
  ].filter((email) => email.length > 0 && !current.includes(email));
  if (older.length === 0) return current;
  const sharedWithOthers = await tx.$queryRaw<{ address: string }[]>`
    SELECT LOWER(TRIM("email")) AS "address" FROM "Attendee"
    WHERE "event_id" = ${eventId}
      AND "id" NOT IN (${Prisma.join(ids)})
      AND LOWER(TRIM("email")) IN (${Prisma.join(older)})
    UNION
    SELECT LOWER(TRIM("recipient_email")) AS "address" FROM "EmailDelivery"
    WHERE "event_id" = ${eventId}
      AND "purpose" = 'initial'
      AND "attendee_id" NOT IN (${Prisma.join(ids)})
      AND LOWER(TRIM("recipient_email")) IN (${Prisma.join(older)})
    UNION
    SELECT LOWER(TRIM(edited."address")) AS "address" FROM (${editedAddresses(
      Prisma.sql`log."event_id" = ${eventId} AND log."attendee_id" <> ALL(${ids}::text[])`,
    )}) AS edited
    WHERE LOWER(TRIM(edited."address")) IN (${Prisma.join(older)})
  `;
  const shared = new Set(sharedWithOthers.map((row) => row.address));
  return [...current, ...older.filter((email) => !shared.has(email))];
}

/**
 * Copies of an attendee's identity that live outside the attendee's own rows, and that neither an
 * erasure (which anonymises the row in place) nor a removal (which deletes it) reaches by itself.
 * Runs inside the caller's transaction, after the attendee rows have been dealt with:
 *
 * - A mail that staff sent to this person's address on behalf of another attendee (the resend
 *   override) sits on that other attendee's delivery: the address goes, the delivery stays, and a
 *   mail still waiting to go out is cancelled.
 * - The central audit log keeps the creation entry of a manually added attendee; only the two
 *   identifying values go, the entry itself (who added someone, when) stays.
 * - An export or an import that has not finished (waiting for the worker, or being run by it) works from the
 *   list as it was: its job is stopped here, so that no file it is still building can be recorded and no import
 *   can create the person again (stopOpenAttendeeJobs).
 * - A guest registration of the person (the form submission) is deleted with its queued mail: the one the attendee
 *   was accepted from, and any of the event with one of the addresses that no attendee was accepted from.
 */
export async function scrubAttendeeTraces(
  tx: Prisma.TransactionClient,
  { eventId, attendeeIds, emails }: ScrubAttendeeTracesParams,
): Promise<ScrubAttendeeTracesResult> {
  if (attendeeIds.length === 0) return { registrations: 0 };
  await stopOpenAttendeeJobs(tx, eventId);
  await invalidateEventExports(tx, eventId);
  const attendeeList = Prisma.join([...attendeeIds]);
  // The guest's registration holds their original name, address, answers, consents and companion; its
  // queued mail goes with it (cascade). The accepted one points at the attendee, but a pending, waitlisted
  // or rejected one from the same person has no attendee, only the address, so both are matched. One that
  // another attendee was accepted from is that attendee's, whatever its address (two attendees can hold one
  // address in two spellings), and goes with them. The addresses are lower case and trimmed, the form the
  // registration's own CHECK keeps. Under the registration queue of the event, which eraseAttendees and
  // removeAttendees take before any attendee (the order is in lockRegistrationQueue); taken again here only so
  // that this delete never runs without it.
  await lockRegistrationQueue(tx, eventId);
  const registrations = await tx.registration.deleteMany({
    where: {
      event_id: eventId,
      OR: [
        { attendee_id: { in: [...attendeeIds] } },
        ...(emails.length > 0 ? [{ attendee_id: null, email: { in: [...emails] } }] : []),
      ],
    },
  });
  if (emails.length > 0) {
    await tx.$executeRaw`
      UPDATE "EmailDelivery" SET
        "status" = CASE
          WHEN "status" = 'queued' OR ("status" = 'failed' AND "retryable" IS TRUE) THEN 'cancelled'
          ELSE "status"
        END,
        "retryable" = CASE
          WHEN "status" = 'queued' OR ("status" = 'failed' AND "retryable" IS TRUE) THEN false
          ELSE "retryable"
        END,
        "recipient_email" = NULL,
        "provider_message_id" = NULL,
        "error" = NULL
      WHERE "event_id" = ${eventId}
        AND LOWER(TRIM("recipient_email")) IN (${Prisma.join([...emails])})
        AND "attendee_id" NOT IN (${attendeeList})
    `;
  }
  await tx.$executeRaw`
    UPDATE "AdminAuditLog" SET "metadata" = "metadata" - 'attendee_name' - 'attendee_email'
    WHERE "action_type" = 'attendee_created_manual'
      AND "metadata"->>'event_id' = ${eventId}
      AND "metadata"->>'attendee_id' IN (${attendeeList})
  `;
  return { registrations: registrations.count };
}
