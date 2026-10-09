import { Prisma } from "@admitto/db/client";
import { scrubAttendeeTraces } from "./attendee-traces.js";

export type RemoveAttendeesParams = {
  eventId: string;
  attendeeIds: readonly string[];
};

export type RemoveAttendeesResult = {
  /** Attendees this call deleted. */
  removedIds: string[];
  /** Ids that match no attendee of this event (or that a concurrent request deleted first). */
  notFoundIds: string[];
  /** Rows deleted along with the attendees, for the audit entry (counts only, never content). */
  counts: {
    emailDeliveries: number;
    walletPasses: number;
    checkIns: number;
  };
  /**
   * The addresses the removed attendees had, lower-cased, for scrubbing event-level copies of them
   * that are not keyed by attendee (see scrubImportJobResults). Attendees that were erased before
   * have a placeholder address and add nothing. They are personal data: used in memory by the
   * caller within the same request, never logged, audited or stored.
   */
  previousEmails: string[];
};

/**
 * Removes attendees from an event for good (the hard delete, for mistakes: a duplicate, a test
 * person, a wrong import). The row goes with its deliveries, wallet pass and check-ins, and with
 * everything that hangs off it by cascade (notes, the per-attendee activity log, item hand-outs),
 * so Reports change; the copies of the identity that live elsewhere are scrubbed too (see
 * scrubAttendeeTraces). Runs inside the caller's transaction so the removal and its audit entry
 * commit together.
 *
 * The attendee rows are locked first, in id order, like an erasure and the guarded send and
 * check-in transactions: deleting the children first can deadlock against one of them. A send or a
 * check-in that was waiting for the lock then finds the attendee gone.
 *
 * Not done here: deleting the wallet pass at the provider (a network call, and the local row is
 * the only place that knows the provider id, so the caller does it before the transaction), saved
 * import results (scrubImportJobResults) and the audit entries.
 */
export async function removeAttendees(
  tx: Prisma.TransactionClient,
  params: RemoveAttendeesParams,
): Promise<RemoveAttendeesResult> {
  const { eventId } = params;
  const requestedIds = [...new Set(params.attendeeIds)];
  const empty: RemoveAttendeesResult = {
    removedIds: [],
    notFoundIds: requestedIds,
    counts: { emailDeliveries: 0, walletPasses: 0, checkIns: 0 },
    previousEmails: [],
  };
  if (requestedIds.length === 0) return empty;

  const found = await tx.$queryRaw<{ id: string; email: string; erased_at: Date | null }[]>`
    SELECT "id", "email", "erased_at" FROM "Attendee"
    WHERE "event_id" = ${eventId} AND "id" IN (${Prisma.join(requestedIds)})
    ORDER BY "id"
    FOR UPDATE
  `;
  if (found.length === 0) return empty;
  const ids = found.map((row) => row.id);

  const [emailDeliveries, walletPasses, checkIns] = await Promise.all([
    tx.emailDelivery.deleteMany({ where: { event_id: eventId, attendee_id: { in: ids } } }),
    tx.walletPass.deleteMany({ where: { attendee_id: { in: ids } } }),
    tx.checkIn.deleteMany({ where: { event_id: eventId, attendee_id: { in: ids } } }),
  ]);

  // RETURNING instead of deleteMany, which reports only a count: the audit entry must name exactly
  // the rows this statement deleted.
  const deleted = await tx.$queryRaw<{ id: string }[]>`
    DELETE FROM "Attendee" WHERE "id" IN (${Prisma.join(ids)}) AND "event_id" = ${eventId}
    RETURNING "id"
  `;
  const removedIds = deleted.map((row) => row.id);
  const removed = new Set(removedIds);
  const previousEmails = [
    ...new Set(
      found
        .filter((row) => removed.has(row.id) && row.erased_at === null)
        .map((row) => row.email.trim().toLowerCase())
        .filter((email) => email.length > 0),
    ),
  ];

  await scrubAttendeeTraces(tx, { eventId, attendeeIds: removedIds, emails: previousEmails });

  return {
    removedIds,
    notFoundIds: requestedIds.filter((id) => !removed.has(id)),
    counts: {
      emailDeliveries: emailDeliveries.count,
      walletPasses: walletPasses.count,
      checkIns: checkIns.count,
    },
    previousEmails,
  };
}
