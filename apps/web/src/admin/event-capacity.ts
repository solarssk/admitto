import type { Context } from "hono";
import type { Prisma, PrismaClient } from "@prisma/client";
import { canManageInstance } from "@admitto/auth";

type CapacityDb = PrismaClient | Prisma.TransactionClient;

export async function countActiveAttendees(db: CapacityDb, eventId: string): Promise<number> {
  return db.attendee.count({
    where: { event_id: eventId, status: { not: "revoked" } },
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
