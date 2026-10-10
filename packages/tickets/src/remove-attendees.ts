import { Prisma } from "@admitto/db/client";
import { collectAttendeeAddresses, scrubAttendeeTraces } from "./attendee-traces.js";

export type RemoveAttendeesParams = {
  eventId: string;
  attendeeIds: readonly string[];
};

/** A wallet pass of a removed attendee that was still at the provider when its row was deleted. */
export type RemoveWalletTarget = {
  attendeeId: string;
  providerPassId: string;
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
   * The passes of the removed attendees that were still at the wallet provider (a provider id, not
   * marked removed) when their rows went, read by the statement that deleted the rows, under the
   * attendee locks. The caller deletes at the provider those it has not deleted yet, after the
   * commit: its own delete ran before the transaction and cannot have seen a pass that was saved
   * in between (an Add to Wallet request that finished right then), and with the row gone this
   * list is the only place that still knows the provider id.
   */
  walletTargets: RemoveWalletTarget[];
  /**
   * The addresses the removed attendees had, lower-cased: the current one and the one their first
   * ticket mail went to (see collectAttendeeAddresses), for scrubbing event-level copies of them
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
 * Not done here: deleting the wallet pass at the provider (a network call: the caller does it
 * before the transaction, while the local row still knows the provider id, and after the commit
 * for the passes in `walletTargets` that this missed), saved import results
 * (scrubImportJobResults) and the audit entries.
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
    walletTargets: [],
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

  // Before the deliveries go: an address the person had before an edit is only in their history.
  const previousEmails = await collectAttendeeAddresses(tx, {
    eventId,
    attendees: found.filter((row) => row.erased_at === null),
  });

  const [emailDeliveries, walletPasses, checkIns] = await Promise.all([
    tx.emailDelivery.deleteMany({ where: { event_id: eventId, attendee_id: { in: ids } } }),
    // RETURNING, like the attendee delete below: the provider ids of exactly the rows this
    // statement deletes are the ones to delete at the provider afterwards.
    tx.$queryRaw<{ attendee_id: string; provider_pass_id: string | null; provider_removed_at: Date | null }[]>`
      DELETE FROM "WalletPass" WHERE "attendee_id" IN (${Prisma.join(ids)})
      RETURNING "attendee_id", "provider_pass_id", "provider_removed_at"
    `,
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

  await scrubAttendeeTraces(tx, { eventId, attendeeIds: removedIds, emails: previousEmails });

  return {
    removedIds,
    notFoundIds: requestedIds.filter((id) => !removed.has(id)),
    counts: {
      emailDeliveries: emailDeliveries.count,
      walletPasses: walletPasses.length,
      checkIns: checkIns.count,
    },
    walletTargets: walletPasses.flatMap((pass) =>
      pass.provider_pass_id && !pass.provider_removed_at
        ? [{ attendeeId: pass.attendee_id, providerPassId: pass.provider_pass_id }]
        : [],
    ),
    previousEmails,
  };
}
