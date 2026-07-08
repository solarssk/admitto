import type { Prisma, PrismaClient } from "@prisma/client";
import { rollbackBadgeForCheckIn } from "./item-states.js";
import { writeActionLog, type OpsAuditContext } from "./ops-audit.js";
import { getAttendeeCard } from "./attendee-card.js";
import type { UndoCheckInResult } from "./types.js";

export class UndoNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndoNotAllowedError";
  }
}

/**
 * Undo last VALID check-in on this event for this device (accidental scan).
 * Rolls back badge if it was auto-issued with that check-in (Lock #1).
 */
export async function undoLastCheckIn(
  params: { eventId: string; audit: OpsAuditContext },
  prisma: PrismaClient,
): Promise<UndoCheckInResult> {
  if (!params.audit.deviceId) {
    throw new UndoNotAllowedError("Device id required for undo");
  }

  return prisma.$transaction(async (tx) => {
    const lastValid = await tx.checkIn.findFirst({
      where: {
        event_id: params.eventId,
        device_id: params.audit.deviceId,
        status: "VALID",
        source: { in: ["scan", "manual"] },
      },
      orderBy: [{ checked_in_at: "desc" }, { id: "desc" }],
    });

    if (!lastValid) {
      throw new UndoNotAllowedError("No check-in to undo on this device");
    }

    const attendee = await tx.attendee.findFirst({
      where: { id: lastValid.attendee_id, event_id: params.eventId },
    });
    if (!attendee?.admitted_at) {
      throw new UndoNotAllowedError("Attendee is not currently admitted");
    }

    const newerValid = await tx.checkIn.findFirst({
      where: {
        event_id: params.eventId,
        attendee_id: lastValid.attendee_id,
        status: "VALID",
        source: { in: ["scan", "manual"] },
        OR: [
          { checked_in_at: { gt: lastValid.checked_in_at } },
          { checked_in_at: lastValid.checked_in_at, id: { gt: lastValid.id } },
        ],
      },
    });
    if (newerValid) {
      throw new UndoNotAllowedError("A newer check-in exists for this guest");
    }

    const cleared = await tx.attendee.updateMany({
      where: {
        id: lastValid.attendee_id,
        event_id: params.eventId,
        admitted_at: { not: null },
      },
      data: { admitted_at: null, admitted_by: null },
    });
    if (cleared.count === 0) {
      throw new UndoNotAllowedError("Check-in could not be undone (concurrent change)");
    }

    await tx.checkIn.create({
      data: {
        attendee_id: lastValid.attendee_id,
        event_id: params.eventId,
        status: "UNDO",
        source: "undo",
        checked_in_by: params.audit.operator ?? null,
        device_id: params.audit.deviceId ?? null,
        notes: `Undo of check-in ${lastValid.id}`,
      },
    });

    await rollbackBadgeForCheckIn(tx, {
      attendeeId: lastValid.attendee_id,
      eventId: params.eventId,
      checkInId: lastValid.id,
      audit: params.audit,
    });

    await writeActionLog(tx, {
      event_id: params.eventId,
      attendee_id: lastValid.attendee_id,
      action_type: "check_in_undo",
      audit: params.audit,
      metadata: { undone_check_in_id: lastValid.id },
    });

    const card = await getAttendeeCard(params.eventId, lastValid.attendee_id, tx);
    if (!card) throw new Error("Attendee missing after undo");

    return { card };
  });
}

/**
 * Revoke a specific attendee's current admission (admin/superadmin action,
 * gated by canManageEvent at the route level — not available to operators).
 * Unlike undoLastCheckIn this is attendee-scoped, not device-scoped: it
 * reverses whichever check-in currently admitted this attendee, regardless
 * of who performed it or when (ADR: this is a deliberate correction, not the
 * split-second "I scanned the wrong badge" safety net).
 */
export async function revokeCheckIn(
  params: { eventId: string; attendeeId: string; audit: OpsAuditContext },
  prisma: PrismaClient,
): Promise<UndoCheckInResult> {
  return prisma.$transaction((tx) => revokeCheckInTx(params, tx));
}

/**
 * The mutation itself, with no AttendeeCardDto build at the end — for
 * callers that only need the side effects (e.g. the pass-revoke endpoint,
 * which builds its own response DTO separately and would otherwise pay for
 * getAttendeeCard's several extra queries — event items, item states,
 * notes, note authors — just to discard the result). Returns the id of the
 * check-in that was undone, if one was found (for callers that want it).
 */
export async function revokeCheckInMutation(
  params: { eventId: string; attendeeId: string; audit: OpsAuditContext },
  tx: Prisma.TransactionClient,
): Promise<{ undoneCheckInId: string | null }> {
  const lastValid = await tx.checkIn.findFirst({
    where: {
      event_id: params.eventId,
      attendee_id: params.attendeeId,
      status: "VALID",
      source: { in: ["scan", "manual"] },
    },
    orderBy: [{ checked_in_at: "desc" }, { id: "desc" }],
  });

  const attendee = await tx.attendee.findFirst({
    where: { id: params.attendeeId, event_id: params.eventId },
  });
  if (!attendee?.admitted_at) {
    throw new UndoNotAllowedError("Attendee is not currently admitted");
  }

  const cleared = await tx.attendee.updateMany({
    where: {
      id: params.attendeeId,
      event_id: params.eventId,
      admitted_at: { not: null },
    },
    data: { admitted_at: null, admitted_by: null },
  });
  if (cleared.count === 0) {
    throw new UndoNotAllowedError("Check-in could not be revoked (concurrent change)");
  }

  await tx.checkIn.create({
    data: {
      attendee_id: params.attendeeId,
      event_id: params.eventId,
      status: "UNDO",
      source: "admin_revoke",
      checked_in_by: params.audit.operator ?? null,
      device_id: params.audit.deviceId ?? null,
      notes: lastValid ? `Revoked check-in ${lastValid.id}` : "Revoked check-in (no VALID row found)",
    },
  });

  // Only roll back a badge if we found the check-in that issued it — an
  // admitted_at with no matching VALID/scan-or-manual row (e.g. a legacy
  // import) has nothing to roll back.
  if (lastValid) {
    await rollbackBadgeForCheckIn(tx, {
      attendeeId: params.attendeeId,
      eventId: params.eventId,
      checkInId: lastValid.id,
      audit: params.audit,
    });
  }

  await writeActionLog(tx, {
    event_id: params.eventId,
    attendee_id: params.attendeeId,
    action_type: "check_in_revoked",
    audit: params.audit,
    metadata: lastValid ? { undone_check_in_id: lastValid.id } : {},
  });

  return { undoneCheckInId: lastValid?.id ?? null };
}

/**
 * Same as revokeCheckIn but takes an already-open transaction — reused by
 * the pass-revoke endpoint so revoking a pass also clears any current
 * admission in the same transaction (PO review: restoring a revoked pass
 * was resurrecting a stale "checked in" state from before the revoke). Runs
 * the mutation, then builds the AttendeeCardDto for the standalone action's
 * response — callers that don't need the card should call
 * revokeCheckInMutation directly instead.
 */
export async function revokeCheckInTx(
  params: { eventId: string; attendeeId: string; audit: OpsAuditContext },
  tx: Prisma.TransactionClient,
): Promise<UndoCheckInResult> {
  await revokeCheckInMutation(params, tx);

  const card = await getAttendeeCard(params.eventId, params.attendeeId, tx);
  if (!card) throw new Error("Attendee missing after revoke");

  return { card };
}
