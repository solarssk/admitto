import type { Prisma, PrismaClient } from "@prisma/client";
import { resolveTicket } from "./resolve.js";

// Local alias matching packages/db/src/status.ts — avoids cross-package build-order dependency.
type AttendeeStatus = "registered" | "confirmed" | "cancelled";
import type { CheckInScanParams, CheckInResult } from "./types.js";

export function isAdmittable(status: AttendeeStatus): boolean {
  return status === "registered" || status === "confirmed";
}

/**
 * Validate a scanned QR/token and atomically record check-in.
 *
 * All DB work runs in a single transaction:
 *   1. resolveTicket — INVALID returned immediately, not persisted (no attendee_id for FK).
 *   2. isAdmittable  — cancelled → REVOKED, logged.
 *   3. Atomic CAS    — WHERE admitted_at IS NULL; count=1 → VALID, count=0 → ALREADY_CHECKED_IN.
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
    const updated = await tx.attendee.updateMany({
      where: { id: attendee.id, event_id: eventId, admitted_at: null },
      data: { admitted_at: now, admitted_by: operator ?? null },
    });

    const isFirst = updated.count === 1;
    const checkInStatus: "VALID" | "ALREADY_CHECKED_IN" = isFirst ? "VALID" : "ALREADY_CHECKED_IN";

    let admittedAt: Date;
    if (isFirst) {
      admittedAt = now;
    } else {
      const current = await tx.attendee.findUnique({
        where: { id: attendee.id },
        select: { admitted_at: true },
      });
      if (!current?.admitted_at) {
        throw new Error(`Consistency error: attendee ${attendee.id} CAS count=0 but admitted_at is null`);
      }
      admittedAt = current.admitted_at;
    }

    await tx.checkIn.create({ data: { ...logBase, status: checkInStatus } });

    return { status: checkInStatus, attendee: attendeePublic, admittedAt };
  });
}

/**
 * Recent scan history for a given event, ordered newest first.
 * Default limit 10, hard cap 50, minimum 1.
 */
export async function getRecentCheckIns(
  eventId: string,
  prisma: PrismaClient,
  limit = 10,
): Promise<unknown[]> {
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 10, 50));
  return prisma.checkIn.findMany({
    where: { event_id: eventId },
    orderBy: { checked_in_at: "desc" },
    take: safeLimit,
    include: {
      attendee: { select: { name: true, ticket_type: true } },
    },
  });
}
