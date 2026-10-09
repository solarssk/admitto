import { Prisma } from "@admitto/db/client";

export type ScrubAttendeeTracesParams = {
  eventId: string;
  /** The attendees that were erased or removed. */
  attendeeIds: readonly string[];
  /** The addresses those attendees had, lower-cased (empty for attendees that were already anonymous). */
  emails: readonly string[];
};

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
