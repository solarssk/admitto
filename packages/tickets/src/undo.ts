import type { PrismaClient } from "@prisma/client";
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
