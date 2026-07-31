import type { PrismaClient } from "@admitto/db";
import { revokeCheckInMutation, UndoNotAllowedError } from "./undo.js";
import {
  resetAllItemStatesForRevoke,
  IllegalItemTransitionError,
  REVOCABLE_ITEM_STATES,
} from "./item-states.js";
import type { OpsAuditContext } from "./ops-audit.js";

/**
 * How many attendees' own per-attendee transactions run concurrently within
 * one chunk of a bulk revoke. Each attendee still gets its own transaction
 * (unchanged); this only bounds how many of those transactions are in
 * flight at once, trading full serialization for throughput on large events
 * without risking one giant cross-attendee transaction.
 */
const BULK_REVOKE_CONCURRENCY = 10;

/** Split an array into fixed-size chunks (last chunk may be smaller). */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Admin/superadmin-only Danger Zone action: revoke every currently-admitted
 * attendee's check-in for the whole event in one go ("Revoke all check-ins").
 * Reuses the same per-attendee mutation as the single-attendee "Revoke
 * check-in" action (revokeCheckInMutation with resetItems: true), so it
 * inherits the same deliberate cascade to reset that attendee's issued items
 * (the PO's ask was that revoking check-in should also revoke items). Each attendee is revoked in
 * its own transaction (matching the existing single-attendee code path)
 * rather than one giant transaction across the whole event — safer under
 * concurrent activity and tolerant of a mid-batch failure. Attendees are
 * processed in bounded-concurrency chunks (BULK_REVOKE_CONCURRENCY) rather
 * than fully serially, for throughput on large events, while each attendee
 * keeps its own independent transaction. A race where an attendee's
 * check-in already changed between the initial scan and this attendee's
 * turn (UndoNotAllowedError) is skipped rather than aborting the rest of
 * the batch. Returns the number of attendees whose check-in was actually
 * revoked.
 */
export async function revokeAllCheckInsForEvent(
  prisma: PrismaClient,
  params: { eventId: string; audit: OpsAuditContext },
): Promise<number> {
  const admitted = await prisma.attendee.findMany({
    where: { event_id: params.eventId, admitted_at: { not: null } },
    select: { id: true },
  });
  if (admitted.length === 0) return 0;

  let revokedCount = 0;
  for (const batch of chunk(admitted, BULK_REVOKE_CONCURRENCY)) {
    const outcomes = await Promise.all(
      batch.map(async (attendee) => {
        try {
          await prisma.$transaction((tx) =>
            revokeCheckInMutation(
              { eventId: params.eventId, attendeeId: attendee.id, audit: params.audit, resetItems: true },
              tx,
            ),
          );
          return true;
        } catch (err) {
          if (!(err instanceof UndoNotAllowedError) && !(err instanceof IllegalItemTransitionError)) throw err;
          // Concurrent change already cleared this attendee's admission between
          // the initial scan and this attendee's turn (UndoNotAllowedError), or
          // the resetItems: true cascade into resetAllItemStatesForRevoke hit a
          // blocked (revoked/cancelled) pass (IllegalItemTransitionError) — either
          // way, skip this attendee and keep the batch going.
          return false;
        }
      }),
    );
    revokedCount += outcomes.filter(Boolean).length;
  }
  return revokedCount;
}

/**
 * Per-attendee reset+chunk+catch loop shared by revokeAllItemsForEvent (whole event) and
 * revokeItemsForAttendees (an explicit selection) below — the two only differ in how they
 * arrive at the attendeeIds list to process; the actual reset, concurrency bound, and
 * race/error tolerance are identical, so it lives here once rather than twice.
 */
async function resetItemsForAttendeeIds(
  prisma: PrismaClient,
  attendeeIds: string[],
  eventId: string,
  audit: OpsAuditContext,
): Promise<number> {
  let revokedCount = 0;
  for (const batch of chunk(attendeeIds, BULK_REVOKE_CONCURRENCY)) {
    const counts = await Promise.all(
      batch.map(async (attendeeId) => {
        try {
          // Sum the transaction's own re-scanned count, not the outer
          // pre-scan itemCount — resetAllItemStatesForRevoke re-checks
          // revocable states inside its own transaction and may find fewer
          // than the pre-scan did (e.g. one was individually reset in the
          // meantime), so the pre-scan count can overstate what actually
          // changed.
          return await prisma.$transaction((tx) =>
            resetAllItemStatesForRevoke(tx, { attendeeId, eventId, audit }),
          );
        } catch (err) {
          if (!(err instanceof IllegalItemTransitionError)) throw err;
          // Blocked (revoked/cancelled) pass or a concurrent change raced
          // this attendee's items — skip, keep the batch going.
          return 0;
        }
      }),
    );
    revokedCount += counts.reduce((sum, n) => sum + n, 0);
  }
  return revokedCount;
}

/**
 * Admin/superadmin-only Danger Zone action: reset every currently
 * issued/returned item for the whole event back to "pending" in one go
 * ("Revoke all items issued"). Independent of check-in status — reuses the
 * same per-attendee bulk reset (resetAllItemStatesForRevoke) that the
 * check-in revoke path also cascades into, but here it's the sole action:
 * check-in state is left untouched. Returns the number of individual item
 * hand-outs actually reset.
 */
export async function revokeAllItemsForEvent(
  prisma: PrismaClient,
  params: { eventId: string; audit: OpsAuditContext },
): Promise<number> {
  const states = await prisma.attendeeItemState.findMany({
    where: {
      state: { in: REVOCABLE_ITEM_STATES },
      event_item: { event_id: params.eventId },
    },
    select: { attendee_id: true },
  });
  if (states.length === 0) return 0;

  const attendeeIds = [...new Set(states.map((s) => s.attendee_id))];
  return resetItemsForAttendeeIds(prisma, attendeeIds, params.eventId, params.audit);
}

/**
 * Same per-attendee item reset as revokeAllItemsForEvent above, scoped to an explicit selection
 * of attendees instead of the whole event — backs the Attendees list's bulk-selection "Revoke
 * items" action (regular admin, not superadmin-only, unlike the Danger Zone's event-wide
 * version). No separate ownership pre-check here: resetItemsForAttendeeIds's own per-attendee
 * transaction already scopes its lookup by both attendeeId and eventId (loadAttendeeForItemAction)
 * and throws the same IllegalItemTransitionError the shared loop already tolerates, so an id from
 * another event (or a stale/deleted one) is silently skipped there instead of being filtered out
 * by a redundant extra query first. Returns the number of individual item hand-outs actually reset.
 */
export async function revokeItemsForAttendees(
  prisma: PrismaClient,
  params: { eventId: string; attendeeIds: string[]; audit: OpsAuditContext },
): Promise<number> {
  return resetItemsForAttendeeIds(
    prisma,
    [...new Set(params.attendeeIds)],
    params.eventId,
    params.audit,
  );
}
