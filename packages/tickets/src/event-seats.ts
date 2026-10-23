import type { PrismaClient } from "@admitto/db";
import { Prisma } from "@admitto/db/client";
import { CAPACITY_EXCLUDED_STATUSES } from "@admitto/db/status";

type SeatsDb = PrismaClient | Prisma.TransactionClient;

/** Prisma where-clause for attendees that are active: they hold a seat and are expected at the door. */
export function activeAttendeeWhere(eventId: string) {
  return {
    event_id: eventId,
    status: { notIn: [...CAPACITY_EXCLUDED_STATUSES] },
  };
}

/**
 * Heads: active attendees (status outside revoked and cancelled). The Overview KPI and the
 * check-in card denominator use this, not the seat count.
 */
export function countActiveAttendees(db: SeatsDb, eventId: string): Promise<number> {
  return db.attendee.count({ where: activeAttendeeWhere(eventId) });
}

/** Heads that are active and already admitted. */
export function countActiveAdmittedAttendees(db: SeatsDb, eventId: string): Promise<number> {
  return db.attendee.count({
    where: { ...activeAttendeeWhere(eventId), admitted_at: { not: null } },
  });
}

/**
 * Seats in use: what the event limit, "full" and "over the limit" compare against. Every active attendee holds one
 * seat, and each of their companions holds one more (D-B3, D-E5): the seat goes with the attendee, so a companion
 * counts only while the attendee is active (the rule of activeAttendeeWhere, status outside revoked and cancelled,
 * from CAPACITY_EXCLUDED_STATUSES) and is out of the count with them. An attendee who was erased before they were
 * admitted is cancelled, which frees both seats; one who was admitted keeps both.
 *
 * One statement, so the heads and the companions are counted from one snapshot. The rule of "active" is written
 * twice, as the where-clause of Prisma and as this SQL, from the same list of statuses; the test of the seat count
 * pins the two to each other for every status, so neither can change alone.
 */
export async function countSeatsInUse(db: SeatsDb, eventId: string): Promise<number> {
  const [row] = await db.$queryRaw<{ seats: number }[]>`
    SELECT (COUNT(DISTINCT a."id") + COUNT(c."id"))::int AS "seats"
    FROM "Attendee" a
    LEFT JOIN "AttendeeCompanion" c ON c."attendee_id" = a."id"
    WHERE a."event_id" = ${eventId} AND a."status" NOT IN (${Prisma.join([...CAPACITY_EXCLUDED_STATUSES])})
  `;
  return row?.seats ?? 0;
}

/**
 * The seats one attendee holds while they are active: themselves and each companion. What restoring them to an
 * active status needs free; read under the capacity lock, with the count of the seats in use.
 */
export async function countSeatsOfAttendee(db: SeatsDb, attendeeId: string): Promise<number> {
  return 1 + (await db.attendeeCompanion.count({ where: { attendee_id: attendeeId } }));
}
