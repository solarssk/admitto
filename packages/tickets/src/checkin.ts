import type { PrismaClient } from "@admitto/db";
import { resolveTicket } from "./resolve.js";
import { admitAttendee, shouldRequireConfirmOnScan } from "./admit.js";
import { getAttendeeCard } from "./attendee-card.js";
import { isAdmittable } from "./admittable.js";
import { lockAttendeeRow } from "./attendee-lock.js";
import { writeActionLog, type OpsAuditContext } from "./ops-audit.js";
import type { CheckInScanParams, CheckInScanResult, CheckInHistoryEntry } from "./types.js";

type AttendeeStatus = "registered" | "confirmed" | "cancelled";

export { isAdmittable } from "./admittable.js";

function auditFromParams(params: CheckInScanParams): OpsAuditContext {
  return {
    operator: params.operator,
    sessionId: params.sessionId,
    deviceId: params.deviceId,
    ip: params.ip,
    timezone: params.timezone,
  };
}

/**
 * Validate a scanned QR/token and record check-in (or preview when require_confirm).
 */
export async function checkInScan(
  params: CheckInScanParams,
  prisma: PrismaClient,
): Promise<CheckInScanResult> {
  const { scanned, eventId } = params;
  const audit = auditFromParams(params);

  const resolved = await resolveTicket(scanned, prisma, { eventId });
  if (!resolved) return { status: "INVALID", confirmed: false };

  const { attendee } = resolved;
  if (!isAdmittable(attendee.status as AttendeeStatus)) {
    const card = await getAttendeeCard(eventId, attendee.id, prisma);
    if (!card) return { status: "INVALID", confirmed: false };

    const recorded = await prisma.$transaction(async (tx) => {
      // The ticket was resolved before this transaction: an erasure in between must not get a
      // check-in row (with the operator's device) written onto the emptied attendee.
      const locked = await lockAttendeeRow(tx, attendee.id, eventId);
      if (!locked || locked.erased) return false;
      await tx.checkIn.create({
        data: {
          attendee_id: attendee.id,
          event_id: eventId,
          checked_in_by: params.operator ?? null,
          device_id: params.deviceId ?? null,
          source: "scan",
          status: "REVOKED",
        },
      });
      return true;
    });
    if (!recorded) return { status: "INVALID", confirmed: false };
    return { status: "REVOKED", confirmed: false, card };
  }

  const requireConfirm = await shouldRequireConfirmOnScan(eventId, prisma);
  if (requireConfirm) {
    const row = await prisma.attendee.findUnique({
      where: { id: attendee.id },
      select: { admitted_at: true },
    });
    if (!row?.admitted_at) {
      const card = await getAttendeeCard(eventId, attendee.id, prisma);
      await prisma.$transaction(async (tx) => {
        await writeActionLog(tx, {
          event_id: eventId,
          attendee_id: attendee.id,
          action_type: "scan_preview",
          audit,
        });
      });
      return {
        status: "PREVIEW",
        confirmed: false,
        card: card ?? undefined,
        attendeeId: attendee.id,
      };
    }
  }

  return admitAttendee({ attendeeId: attendee.id, eventId, method: "scan", audit }, prisma);
}

/**
 * Recent scan history for a given event, ordered newest first.
 */
export async function getRecentCheckIns(
  eventId: string,
  prisma: PrismaClient,
  limit = 10,
): Promise<CheckInHistoryEntry[]> {
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 10, 100));
  return prisma.checkIn.findMany({
    where: {
      event_id: eventId,
      // An erased attendee's check-ins stay for the counts, but the sidebar is for acting on recent
      // scans and an erased entry cannot be acted on.
      attendee: { erased_at: null },
      // scan/manual = admissions; undo/admin_revoke = reversals (#449 review) —
      // without these the sidebar kept showing a reversed admission as a
      // permanently-green "Checked in" row with no indication it was undone.
      source: { in: ["scan", "manual", "undo", "admin_revoke"] },
      // Duplicate scan warnings are audit records, not recent activity.
      status: { not: "ALREADY_CHECKED_IN" },
    },
    orderBy: [{ checked_in_at: "desc" }, { id: "desc" }],
    take: safeLimit,
    include: {
      attendee: {
        select: {
          name: true,
          ticket_type: true,
          custom_data: true,
          company: true,
          department: true,
        },
      },
    },
  });
}
