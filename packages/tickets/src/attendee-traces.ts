import { Prisma } from "@admitto/db/client";

export type ScrubAttendeeTracesParams = {
  eventId: string;
  /** The attendees that were erased or removed. */
  attendeeIds: readonly string[];
  /** The addresses those attendees had, lower-cased (empty for attendees that were already anonymous). */
  emails: readonly string[];
};

/** An attendee about to be erased or removed, as far as collecting their addresses goes. */
export type AttendeeAddressSource = { id: string; email: string };

const normalizedAddress = (value: string): string => value.trim().toLowerCase();

/**
 * The addresses to scrub for attendees that are about to be erased or removed (lower-cased and trimmed): the one
 * each has now, and the ones their own deliveries went to. An attendee whose address was edited has the older ones
 * only in that history, which the erasure empties and the removal deletes, so this has to run before either. An
 * address that another attendee of the event holds now is that person's, not an old one of these attendees: it is
 * left out, because scrubbing it would blank, and cancel, mail that belongs to somebody else.
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
  const delivered = await tx.emailDelivery.findMany({
    where: { event_id: eventId, attendee_id: { in: ids }, recipient_email: { not: null } },
    select: { recipient_email: true },
    distinct: ["recipient_email"],
  });
  const older = [
    ...new Set(
      delivered
        .map((row) => row.recipient_email)
        .filter((email): email is string => email !== null)
        .map(normalizedAddress),
    ),
  ].filter((email) => email.length > 0 && !current.includes(email));
  if (older.length === 0) return current;
  const heldByOthers = await tx.$queryRaw<{ email: string }[]>`
    SELECT LOWER(TRIM("email")) AS "email" FROM "Attendee"
    WHERE "event_id" = ${eventId}
      AND "id" NOT IN (${Prisma.join(ids)})
      AND LOWER(TRIM("email")) IN (${Prisma.join(older)})
  `;
  const held = new Set(heldByOthers.map((row) => row.email));
  return [...current, ...older.filter((email) => !held.has(email))];
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
 */
export async function scrubAttendeeTraces(
  tx: Prisma.TransactionClient,
  { eventId, attendeeIds, emails }: ScrubAttendeeTracesParams,
): Promise<void> {
  if (attendeeIds.length === 0) return;
  const attendeeList = Prisma.join([...attendeeIds]);
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
}
