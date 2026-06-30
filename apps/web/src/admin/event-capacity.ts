import type { Context } from "hono";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { AttendeeStatus } from "@admitto/db";
import { canManageInstance } from "@admitto/auth";

type CapacityDb = PrismaClient | Prisma.TransactionClient;

/** Attendee statuses that do not consume event capacity. */
export const CAPACITY_EXCLUDED_STATUSES = ["revoked", "cancelled"] as const satisfies readonly AttendeeStatus[];

const activeAttendeeWhere = (eventId: string) => ({
  event_id: eventId,
  status: { notIn: [...CAPACITY_EXCLUDED_STATUSES] },
});

export function eventCapacityLockKey(eventId: string): string {
  return `event-capacity:${eventId}`;
}

/** Serialize manual create, restore, and import commit against the same event capacity. */
export async function acquireEventCapacityLock(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${eventCapacityLockKey(eventId)}))`,
  );
}

/** Count attendees that consume event capacity (excludes revoked and cancelled). */
export async function countActiveAttendees(db: CapacityDb, eventId: string): Promise<number> {
  return db.attendee.count({ where: activeAttendeeWhere(eventId) });
}

/** Admitted attendees that still consume capacity (same scope as countActiveAttendees). */
export async function countActiveAdmittedAttendees(db: CapacityDb, eventId: string): Promise<number> {
  return db.attendee.count({
    where: { ...activeAttendeeWhere(eventId), admitted_at: { not: null } },
  });
}

export type CapacityOverrideMeta = {
  forced: true;
  capacity: number;
  current: number;
};

/**
 * Returns a 409 Response when capacity would be exceeded, null when OK,
 * or override metadata when superadmin uses ?force=1.
 */
export async function assertEventCapacityForIncoming(
  c: Context,
  db: CapacityDb,
  eventId: string,
  incomingCount: number,
): Promise<Response | CapacityOverrideMeta | null> {
  if (incomingCount <= 0) return null;

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { capacity: true },
  });
  if (event?.capacity == null) return null;

  const current = await countActiveAttendees(db, eventId);
  const projected = current + incomingCount;
  if (projected <= event.capacity) return null;

  const forceOverride = c.req.query("force") === "1";
  const auth = c.get("auth");
  const isSuperadmin = await canManageInstance(db, auth.userId);
  if (forceOverride && isSuperadmin) {
    return { forced: true, capacity: event.capacity, current };
  }

  if (incomingCount === 1) {
    return c.json(
      {
        code: "event_full",
        error: "Event has reached its capacity limit.",
        capacity: event.capacity,
        current,
      },
      409,
    );
  }

  return c.json(
    {
      code: "event_full",
      error: `Import would exceed capacity. ${current} existing + ${incomingCount} new = ${projected} > ${event.capacity}.`,
      capacity: event.capacity,
      current,
      incoming: incomingCount,
      projected,
    },
    409,
  );
}
