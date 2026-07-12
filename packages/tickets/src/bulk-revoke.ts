import type { PrismaClient } from "@prisma/client";
import { revokeCheckInMutation, UndoNotAllowedError } from "./undo.js";
import {
  resetAllItemStatesForRevoke,
  IllegalItemTransitionError,
  REVOCABLE_ITEM_STATES,
} from "./item-states.js";
import type { OpsAuditContext } from "./ops-audit.js";

/**
 * Admin/superadmin-only Danger Zone action: revoke every currently-admitted
 * attendee's check-in for the whole event in one go ("Revoke all check-ins").
 * Reuses the same per-attendee mutation as the single-attendee "Revoke
 * check-in" action (revokeCheckInMutation with resetItems: true), so it
 * inherits the same deliberate cascade to reset that attendee's issued items
 * ("przy revoke checkin było też revoke items"). Each attendee is revoked in
 * its own transaction (matching the existing single-attendee code path)
 * rather than one giant transaction across the whole event — safer under
 * concurrent activity and tolerant of a mid-batch failure. A race where an
 * attendee's check-in already changed between the initial scan and this
 * attendee's turn (UndoNotAllowedError) is skipped rather than aborting the
 * rest of the batch. Returns the number of attendees whose check-in was
 * actually revoked.
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
  for (const attendee of admitted) {
    try {
      await prisma.$transaction((tx) =>
        revokeCheckInMutation(
          { eventId: params.eventId, attendeeId: attendee.id, audit: params.audit, resetItems: true },
          tx,
        ),
      );
      revokedCount++;
    } catch (err) {
      if (!(err instanceof UndoNotAllowedError)) throw err;
      // Concurrent change already cleared this attendee's admission between
      // the initial scan and this attendee's turn — skip, keep the batch going.
    }
  }
  return revokedCount;
}

/**
 * Admin/superadmin-only Danger Zone action: reset every currently
 * issued/returned item for the whole event back to "pending" in one go
 * ("Revoke all items issued"). Independent of check-in status — reuses the
 * same per-attendee bulk reset (resetAllItemStatesForRevoke) that the
 * check-in revoke path also cascades into, but here it's the sole action:
 * check-in state is left untouched. Each attendee is reset in its own
 * transaction, tolerant of a mid-batch race (IllegalItemTransitionError,
 * e.g. the attendee's pass stopped being active between the initial scan and
 * this attendee's turn) by skipping that attendee rather than aborting the
 * rest of the batch. Returns the number of individual item hand-outs reset
 * (not the number of attendees) so the caller can report an accurate count.
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

  const itemCountByAttendee = new Map<string, number>();
  for (const s of states) {
    itemCountByAttendee.set(s.attendee_id, (itemCountByAttendee.get(s.attendee_id) ?? 0) + 1);
  }

  let revokedCount = 0;
  for (const [attendeeId, itemCount] of itemCountByAttendee) {
    try {
      await prisma.$transaction((tx) =>
        resetAllItemStatesForRevoke(tx, { attendeeId, eventId: params.eventId, audit: params.audit }),
      );
      revokedCount += itemCount;
    } catch (err) {
      if (!(err instanceof IllegalItemTransitionError)) throw err;
      // Concurrent change raced this attendee's items — skip, keep the batch going.
    }
  }
  return revokedCount;
}
