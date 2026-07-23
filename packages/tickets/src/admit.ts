import type { Prisma, PrismaClient } from "@prisma/client";
import { issueBadgeOnCheckIn } from "./item-states.js";
import { writeActionLog, type OpsAuditContext } from "./ops-audit.js";
import { parseEventOpsConfig, loadEventOpsConfig } from "./ops-config.js";
import { isAdmittable, ADMITTABLE_STATUS_LIST } from "./admittable.js";
import { getAttendeeCard } from "./attendee-card.js";
import type { AdmitResult, AttendeeCardDto } from "./types.js";

type AttendeeStatus = "registered" | "confirmed" | "cancelled";
const ADMITTABLE_STATUSES = ADMITTABLE_STATUS_LIST as AttendeeStatus[];

async function requireCard(
  eventId: string,
  attendeeId: string,
  tx: Prisma.TransactionClient,
): Promise<AttendeeCardDto> {
  const card = await getAttendeeCard(eventId, attendeeId, tx);
  if (!card) throw new Error(`Attendee card missing for ${attendeeId}`);
  return card;
}

export type AdmitAttendeeParams = {
  attendeeId: string;
  eventId: string;
  method: "scan" | "manual";
  audit: OpsAuditContext;
  notes?: string;
};

/**
 * Single CAS path for scan and manual check-in (ADR 0010 §4).
 *
 * Transaction order (Lock #1 — required for undo badge rollback):
 *   1. CAS admitted_at + create CheckIn (capture checkIn.id)
 *   2. AttendeeActionLog check_in
 *   3. If badge_at_entry: issue badge + item_issued log with metadata.check_in_id
 */
export async function admitAttendee(
  params: AdmitAttendeeParams,
  prisma: PrismaClient,
): Promise<AdmitResult> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<AdmitResult> => {
    const attendee = await tx.attendee.findFirst({
      where: { id: params.attendeeId, event_id: params.eventId },
    });
    if (!attendee) return { status: "INVALID", confirmed: false };

    const card = await requireCard(params.eventId, params.attendeeId, tx);
    const logBase = {
      attendee_id: attendee.id,
      event_id: params.eventId,
      checked_in_by: params.audit.operator ?? null,
      device_id: params.audit.deviceId ?? null,
      source: params.method,
      notes: params.notes?.trim() || null,
    };

    if (!isAdmittable(attendee.status as AttendeeStatus)) {
      await tx.checkIn.create({ data: { ...logBase, status: "REVOKED" } });
      return { status: "REVOKED", confirmed: false, card };
    }

    if (attendee.admitted_at) {
      await tx.checkIn.create({ data: { ...logBase, status: "ALREADY_CHECKED_IN" } });
      return {
        status: "ALREADY_CHECKED_IN",
        confirmed: true,
        card,
        admittedAt: attendee.admitted_at,
      };
    }

    const now = new Date();
    const updated = await tx.attendee.updateMany({
      where: {
        id: attendee.id,
        event_id: params.eventId,
        admitted_at: null,
        status: { in: ADMITTABLE_STATUSES },
      },
      data: { admitted_at: now, admitted_by: params.audit.operator ?? null },
    });

    if (updated.count === 0) {
      const current = await tx.attendee.findUnique({
        where: { id: attendee.id },
        select: { admitted_at: true, status: true },
      });
      if (!current) throw new Error(`Consistency error: attendee ${attendee.id} disappeared`);
      if (!isAdmittable(current.status as AttendeeStatus)) {
        await tx.checkIn.create({ data: { ...logBase, status: "REVOKED" } });
        return { status: "REVOKED", confirmed: false, card: await requireCard(params.eventId, params.attendeeId, tx) };
      }
      if (!current.admitted_at) {
        throw new Error(`Consistency error: attendee ${attendee.id} CAS count=0 but admitted_at is null`);
      }
      await tx.checkIn.create({ data: { ...logBase, status: "ALREADY_CHECKED_IN" } });
      return {
        status: "ALREADY_CHECKED_IN",
        confirmed: true,
        card: await requireCard(params.eventId, params.attendeeId, tx),
        admittedAt: current.admitted_at,
      };
    }

    const checkIn = await tx.checkIn.create({
      data: { ...logBase, status: "VALID" },
    });

    await writeActionLog(tx, {
      event_id: params.eventId,
      attendee_id: attendee.id,
      action_type: "check_in",
      audit: params.audit,
      metadata: { method: params.method, check_in_id: checkIn.id },
    });

    const event = await tx.event.findUnique({
      where: { id: params.eventId },
      select: { ops_config: true },
    });
    const ops = parseEventOpsConfig(event?.ops_config);
    if (ops.badge_at_entry) {
      await issueBadgeOnCheckIn(tx, {
        attendeeId: attendee.id,
        eventId: params.eventId,
        checkInId: checkIn.id,
        audit: params.audit,
      });
    }

    return {
      status: "VALID",
      confirmed: true,
      card: await requireCard(params.eventId, params.attendeeId, tx),
      admittedAt: now,
    };
  });
}

export async function shouldRequireConfirmOnScan(
  eventId: string,
  prisma: PrismaClient,
): Promise<boolean> {
  return (await loadEventOpsConfig(eventId, prisma)).require_confirm_on_scan;
}
