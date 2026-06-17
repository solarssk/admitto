import type { Prisma, PrismaClient } from "@prisma/client";
import { resolveTicket } from "./resolve.js";
import { admitAttendee, shouldRequireConfirmOnScan } from "./admit.js";
import { getAttendeeCard } from "./attendee-card.js";
import { isAdmittable } from "./admittable.js";
import type { OpsAuditContext } from "./ops-audit.js";
import type { CheckInScanParams, CheckInScanResult, CheckInHistoryEntry } from "./types.js";

type AttendeeStatus = "registered" | "confirmed" | "cancelled";

export { isAdmittable } from "./admittable.js";

function auditFromParams(params: CheckInScanParams): OpsAuditContext {
  return {
    operator: params.operator,
    sessionId: params.sessionId,
    deviceId: params.deviceId,
    ip: params.ip,
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
    await prisma.checkIn.create({
      data: {
        attendee_id: attendee.id,
        event_id: eventId,
        checked_in_by: params.operator ?? null,
        device_id: params.deviceId ?? null,
        source: "scan",
        status: "REVOKED",
      },
    });
    const card = await getAttendeeCard(eventId, attendee.id, prisma);
    if (!card) return { status: "INVALID", confirmed: false };
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
      source: { in: ["scan", "manual"] },
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
