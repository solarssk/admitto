import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { canManageInstance, listAdminEvents } from "@admitto/auth";
import { writeAdminAuditLog } from "@admitto/tickets";
import { adminAuditFromContext } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";

const slugField = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9_]+$/, "Slug: lowercase letters, numbers, underscores only");

const createEventSchema = z.object({
  title: z.string().trim().min(1).max(100),
  slug: slugField,
  date: z.union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  location: z.string().trim().max(200).optional(),
});

type EventJsonRow = {
  id: string;
  title: string;
  slug: string;
  date: Date;
  location: string | null;
  organization_id: string;
  archived_at: Date | null;
};

/** Map an event row to the admin picker JSON shape. */
function serializeEventDto(event: EventJsonRow, count?: number) {
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    date: event.date.toISOString(),
    location: event.location,
    organization_id: event.organization_id,
    archived_at: event.archived_at?.toISOString() ?? null,
    ...(count !== undefined ? { attendee_count: count } : {}),
  };
}

/** GET /api/admin/events — admin picker (session gate applied upstream). Query: includeArchived=true. */
export async function handleGetAdminEvents(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  const includeArchived = c.req.query("includeArchived") === "true";
  const events = await listAdminEvents(db, auth.userId, { includeArchived });

  const counts = await db.attendee.groupBy({
    by: ["event_id"],
    where: { event_id: { in: events.map((e) => e.id) } },
    _count: { _all: true },
  });
  const countByEvent = new Map(counts.map((row) => [row.event_id, row._count._all]));

  return c.json({
    events: events.map((e) => serializeEventDto(e, countByEvent.get(e.id) ?? 0)),
  });
}

/** POST /api/admin/events — create event (superadmin or org admin). */
export async function handleCreateEvent(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "validation_failed";
    return c.json({ error: message }, 400);
  }

  const { title, slug, date, location } = parsed.data;

  const isSuperadmin = await canManageInstance(db, auth.userId);
  let orgId: string;
  if (isSuperadmin) {
    orgId = await resolveInstanceOrganizationId(db);
  } else {
    const adminRole = await db.roleAssignment.findFirst({
      where: { user_id: auth.userId, role: "admin", scope_type: "organization" },
    });
    if (!adminRole?.scope_id) return c.json({ error: "forbidden" }, 403);
    orgId = adminRole.scope_id;
  }

  const existing = await db.event.findUnique({ where: { slug } });
  if (existing) {
    return c.json({ code: "slug_taken", error: "Slug is already in use." }, 409);
  }

  const dateValue = new Date(date.includes("T") ? date : `${date}T00:00:00.000Z`);

  const event = await db.event.create({
    data: {
      title,
      slug,
      date: dateValue,
      location: location?.trim() ? location.trim() : null,
      organization_id: orgId,
    },
  });

  const audit = adminAuditFromContext(c);
  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator ?? auth.userId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType: "event_created",
    metadata: { eventId: event.id, title: event.title, slug: event.slug },
  });

  return c.json(serializeEventDto(event), 201);
}
