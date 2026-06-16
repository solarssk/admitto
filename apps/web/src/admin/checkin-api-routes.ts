import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { listCheckInEvents } from "@admitto/auth";

/** GET /api/checkin/events — session-only capability list (P4). */
export async function handleGetCheckinEvents(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  const events = await listCheckInEvents(db, auth.userId);

  return c.json({
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      slug: e.slug,
      date: e.date.toISOString(),
      location: e.location,
      organization_id: e.organization_id,
    })),
  });
}
