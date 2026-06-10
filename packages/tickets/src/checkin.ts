import type { Prisma, PrismaClient } from "@prisma/client";
import { resolveTicket } from "./resolve.js";
import type { CheckInScanParams, CheckInResult, CheckInHistoryEntry } from "./types.js";

// Local alias — avoids cross-package build-order dependency. Follow-up: move to @admitto/shared.
type AttendeeStatus = "registered" | "confirmed" | "cancelled";

// Admittable statuses — single source of truth for both isAdmittable() and the CAS predicate.
const ADMITTABLE_STATUSES: AttendeeStatus[] = ["registered", "confirmed"];

export function isAdmittable(status: AttendeeStatus): boolean {
  return ADMITTABLE_STATUSES.includes(status);
}

/**
 * Validate a scanned QR/token and atomically record check-in.
 *
 * All DB work runs in a single transaction:
 *   1. resolveTicket — INVALID returned immediately, not persisted (no attendee_id for FK).
 *   2. isAdmittable  — cancelled → REVOKED, logged.
 *   3. Atomic CAS    — WHERE admitted_at IS NULL AND status IN admittable;
 *                      count=1 → VALID, count=0 → re-read to distinguish REVOKED vs ALREADY_CHECKED_IN.
 *   4. CheckIn log   — written for every resolved scan (VALID / ALREADY_CHECKED_IN / REVOKED).
 */
export async function checkInScan(
  params: CheckInScanParams,
  prisma: PrismaClient,
): Promise<CheckInResult> {
  const { scanned, eventId, operator, deviceId } = params;

  return prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<CheckInResult> => {
    const resolved = await resolveTicket(scanned, tx, { eventId });
    if (!resolved) return { status: "INVALID" };

    const { attendee } = resolved;
    const attendeePublic = { name: attendee.name, ticket_type: attendee.ticket_type };
    const logBase = {
      attendee_id: attendee.id,
      event_id: eventId,
      checked_in_by: operator ?? null,
      device_id: deviceId ?? null,
      source: "scan",
    };

    if (!isAdmittable(attendee.status as AttendeeStatus)) {
      await tx.checkIn.create({ data: { ...logBase, status: "REVOKED" } });
      return { status: "REVOKED", attendee: attendeePublic };
    }

    const now = new Date();
    // CAS: include status condition to guard against status change between resolveTicket and this write.
    const updated = await tx.attendee.updateMany({
      where: {
        id: attendee.id,
        event_id: eventId,
        admitted_at: null,
        status: { in: ADMITTABLE_STATUSES },
      },
      data: { admitted_at: now, admitted_by: operator ?? null },
    });

    if (updated.count === 0) {
      // Either already admitted (race) or status changed to non-admittable (TOCTOU).
      const current = await tx.attendee.findUnique({
        where: { id: attendee.id },
        select: { admitted_at: true, status: true },
      });
      if (!current) {
        throw new Error(`Consistency error: attendee ${attendee.id} disappeared mid-transaction`);
      }
      if (!isAdmittable(current.status as AttendeeStatus)) {
        await tx.checkIn.create({ data: { ...logBase, status: "REVOKED" } });
        return { status: "REVOKED", attendee: attendeePublic };
      }
      if (!current.admitted_at) {
        throw new Error(`Consistency error: attendee ${attendee.id} CAS count=0 but admitted_at is null`);
      }
      await tx.checkIn.create({ data: { ...logBase, status: "ALREADY_CHECKED_IN" } });
      return { status: "ALREADY_CHECKED_IN", attendee: attendeePublic, admittedAt: current.admitted_at };
    }

    await tx.checkIn.create({ data: { ...logBase, status: "VALID" } });
    return { status: "VALID", attendee: attendeePublic, admittedAt: now };
  });
}

/**
 * Recent scan history for a given event, ordered newest first.
 * Default limit 10, hard cap 50, minimum 1.
 * Secondary sort by id for deterministic order within the same second (SQLite timestamp precision).
 */
export async function getRecentCheckIns(
  eventId: string,
  prisma: PrismaClient,
  limit = 10,
): Promise<CheckInHistoryEntry[]> {
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 10, 50));
  return prisma.checkIn.findMany({
    where: { event_id: eventId },
    orderBy: [{ checked_in_at: "desc" }, { id: "desc" }],
    take: safeLimit,
    include: {
      attendee: { select: { name: true, ticket_type: true } },
    },
  }) as Promise<CheckInHistoryEntry[]>;
}
