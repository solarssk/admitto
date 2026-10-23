import type { Context } from "hono";
import type { Prisma, PrismaClient } from "@admitto/db";
import { CAPACITY_EXCLUDED_STATUSES } from "@admitto/db";
import { canManageInstance } from "@admitto/auth";
import { countSeatsInUse } from "@admitto/tickets";

type CapacityDb = PrismaClient | Prisma.TransactionClient;

// Single source of truth lives in @admitto/db; re-exported so existing
// apps/web callers keep importing from this module.
export { CAPACITY_EXCLUDED_STATUSES };

export { acquireEventCapacityLock, eventCapacityLockKey, EVENT_CAPACITY_TRANSACTION_OPTIONS, runEventCapacityTransaction } from "@admitto/tickets";

export { countActiveAdmittedAttendees, countActiveAttendees, countSeatsInUse, countSeatsOfAttendee } from "@admitto/tickets";

/** Audit metadata when a superadmin bypasses capacity with `?force=1`. */
export type CapacityOverrideMeta = {
  forced: true;
  capacity: number;
  current: number;
};

/** True when a status PATCH moves an attendee back into the capacity-consuming pool. */
export function isCapacityReactivation(fromStatus: string, toStatus: string | undefined): boolean {
  return (
    toStatus === "registered" &&
    (CAPACITY_EXCLUDED_STATUSES as readonly string[]).includes(fromStatus)
  );
}

/** How a refusal for want of room is worded when more than one seat is asked for. */
export type CapacityRequest = {
  /**
   * The request restores an attendee, who comes back with their companions: `incomingCount` is the seats of the
   * attendee and each companion, and the refusal says so in places, not in a number of people to import.
   */
  restoring?: boolean;
};

/**
 * Returns a 409 Response when capacity would be exceeded, null when OK,
 * or override metadata when superadmin uses ?force=1. `incomingCount` is a number of seats (an attendee is
 * one, and so is each companion), not of people.
 */
export async function assertEventCapacityForIncoming(
  c: Context,
  db: CapacityDb,
  eventId: string,
  incomingCount: number,
  request: CapacityRequest = {},
): Promise<Response | CapacityOverrideMeta | null> {
  if (incomingCount <= 0) return null;

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { capacity: true },
  });
  if (event?.capacity == null) return null;

  const current = await countSeatsInUse(db, eventId);
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

  const free = Math.max(0, event.capacity - current);
  return c.json(
    {
      code: "event_full",
      error: request.restoring
        ? `Not enough free places: restoring this attendee needs ${incomingCount} (the attendee and ${incomingCount - 1} companion${incomingCount === 2 ? "" : "s"}), and ${free} ${free === 1 ? "is" : "are"} free.`
        : `Import would exceed capacity. ${current} existing + ${incomingCount} new = ${projected} > ${event.capacity}.`,
      capacity: event.capacity,
      current,
      incoming: incomingCount,
      projected,
    },
    409,
  );
}
