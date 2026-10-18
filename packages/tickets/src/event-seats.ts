import type { Prisma, PrismaClient } from "@admitto/db";
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
 * Seats in use: what the event limit, "full" and "over the limit" compare against. Today every
 * active attendee holds exactly one seat, so this equals the head count; a companion will add one
 * more seat each (v0.8.0), and only this function changes then.
 */
export function countSeatsInUse(db: SeatsDb, eventId: string): Promise<number> {
  return countActiveAttendees(db, eventId);
}
