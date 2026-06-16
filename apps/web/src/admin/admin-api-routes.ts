import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { listAdminEvents } from "@admitto/auth";

function serializeEvent(event: Awaited<ReturnType<typeof listAdminEvents>>[number], count?: number) {
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    date: event.date.toISOString(),
    location: event.location,
    organization_id: event.organization_id,
    ...(count !== undefined ? { attendee_count: count } : {}),
  };
}

/** GET /api/admin/events — admin picker (session gate applied upstream). */
export async function handleGetAdminEvents(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  const events = await listAdminEvents(db, auth.userId);

  const counts = await db.attendee.groupBy({
    by: ["event_id"],
    where: { event_id: { in: events.map((e) => e.id) } },
    _count: { _all: true },
  });
  const countByEvent = new Map(counts.map((row) => [row.event_id, row._count._all]));

  return c.json({
    events: events.map((e) => serializeEvent(e, countByEvent.get(e.id) ?? 0)),
  });
}
