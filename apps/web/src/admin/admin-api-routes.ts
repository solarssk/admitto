import type { Context } from "hono";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { canManageInstance, listAdminEvents } from "@admitto/auth";
import { writeAdminAuditLog } from "@admitto/tickets";
import { adminAuditFromContext } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";
import { timezoneField } from "./timezone.js";

const slugField = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_-]+$/, "Slug: lowercase letters, numbers, hyphens, and underscores only");

const dateOnlyField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => isValidCalendarDate(value), "Invalid date");

const createEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: slugField,
  date: z.union([z.string().datetime({ offset: true }), dateOnlyField]),
  location: z.string().trim().max(300).optional(),
  timezone: timezoneField,
});

type EventJsonRow = {
  id: string;
  title: string;
  slug: string;
  date: Date;
  timezone: string;
  location: string | null;
  organization_id: string;
  archived_at: Date | null;
};

function isValidCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/** Parse date-only values at UTC noon to avoid locale off-by-one in date pickers. */
function parseEventDateInput(date: string): Date {
  return new Date(date.includes("T") ? date : `${date}T12:00:00.000Z`);
}

/** Map an event row to the admin picker JSON shape. */
function serializeEventDto(event: EventJsonRow, count?: number) {
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    date: event.date.toISOString(),
    timezone: event.timezone,
    location: event.location,
    organization_id: event.organization_id,
    archived_at: event.archived_at?.toISOString() ?? null,
    ...(count !== undefined ? { attendee_count: count } : {}),
  };
}

async function resolveCreateEventOrgId(
  db: PrismaClient,
  userId: string,
  isSuperadmin: boolean,
): Promise<string | Response> {
  if (isSuperadmin) {
    return resolveInstanceOrganizationId(db);
  }

  const adminRoles = await db.roleAssignment.findMany({
    where: { user_id: userId, role: "admin", scope_type: "organization" },
    select: { scope_id: true },
    orderBy: { scope_id: "asc" },
  });
  const orgIds = adminRoles
    .map((role) => role.scope_id)
    .filter((scopeId): scopeId is string => scopeId != null);

  if (orgIds.length === 0) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }
  if (orgIds.length > 1) {
    return new Response(
      JSON.stringify({
        error:
          "Multiple organization admin assignments — organization selection is not supported yet.",
      }),
      { status: 422 },
    );
  }
  return orgIds[0]!;
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

  const { title, slug, date, location, timezone } = parsed.data;
  const dateValue = parseEventDateInput(date);

  const isSuperadmin = await canManageInstance(db, auth.userId);
  const orgIdOrRes = await resolveCreateEventOrgId(db, auth.userId, isSuperadmin);
  if (orgIdOrRes instanceof Response) return orgIdOrRes;
  const orgId = orgIdOrRes;

  const existing = await db.event.findUnique({ where: { slug } });
  if (existing) {
    return c.json({ code: "slug_taken", error: "Slug is already in use." }, 409);
  }

  const audit = adminAuditFromContext(c);

  try {
    const event = await db.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          title,
          slug,
          date: dateValue,
          timezone,
          location: location?.trim() ? location.trim() : null,
          organization_id: orgId,
        },
      });

      await writeAdminAuditLog(tx, {
        organizationId: orgId,
        actorUserId: audit.operator ?? auth.userId,
        sessionId: audit.sessionId,
        ip: audit.ip,
        actionType: "event_created",
        metadata: { eventId: created.id, title: created.title, slug: created.slug },
      });

      return created;
    });

    return c.json({ event: serializeEventDto(event) }, 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return c.json({ code: "slug_taken", error: "Slug is already in use." }, 409);
    }
    console.error("[audit] event_created transaction failed", err);
    return c.json({ code: "audit_failed" }, 500);
  }
}
