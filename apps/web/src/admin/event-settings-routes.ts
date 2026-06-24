/**
 * Event settings: read/update basic fields and superadmin PII export (prompt 54).
 */
import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { canManageInstance } from "@admitto/auth";
import { writeAdminAuditLog } from "@admitto/tickets";
import { z } from "zod";
import { adminAuditFromContext, assertEventManageAccess, requireEventId } from "./admin-helpers.js";

const dateOnlyField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => isValidCalendarDate(value), "Invalid date");

/**
 * Strict schema: unknown keys (including `slug`) return 400 — slug is immutable and
 * clients must omit it; we do not silently strip extra fields.
 */
const patchEventSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    date: z.union([z.string().datetime(), dateOnlyField]).optional(),
    location: z.string().trim().max(300).nullish(),
    capacity: z.number().int().positive().nullish(),
  })
  .strict();

export type EventSettingsDto = {
  id: string;
  title: string;
  slug: string;
  date: string;
  location: string | null;
  capacity: number | null;
  status: "active" | "archived";
  organization_name: string;
  active_items: Array<{ id: string; name: string; enabled: boolean }>;
};

type EventSettingsRow = {
  id: string;
  title: string;
  slug: string;
  date: Date;
  location: string | null;
  capacity: number | null;
  archived_at: Date | null;
  organization: { name: string };
  event_items: Array<{ id: string; label: string; enabled: boolean }>;
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

function serializeEventSettings(event: EventSettingsRow): EventSettingsDto {
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    date: event.date.toISOString(),
    location: event.location,
    capacity: event.capacity,
    status: event.archived_at ? "archived" : "active",
    organization_name: event.organization.name,
    active_items: event.event_items.map((item) => ({
      id: item.id,
      name: item.label,
      enabled: item.enabled,
    })),
  };
}

async function loadEventSettingsRow(
  db: PrismaClient,
  eventId: string,
): Promise<(EventSettingsRow & { organization_id: string }) | null> {
  return db.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      slug: true,
      date: true,
      location: true,
      capacity: true,
      archived_at: true,
      organization_id: true,
      organization: { select: { name: true } },
      event_items: {
        select: { id: true, label: true, enabled: true },
        orderBy: { label: "asc" },
      },
    },
  });
}

/** GET /api/admin/events/:eventId/settings */
export async function handleGetEventSettings(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const event = await loadEventSettingsRow(db, eventId);
  if (!event) return c.json({ error: "not_found" }, 404);

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  return c.json(serializeEventSettings(event));
}

/** PATCH /api/admin/events/:eventId — basic fields only (archive guard applied upstream). */
export async function handlePatchEvent(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = patchEventSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "validation_failed";
    return c.json({ error: message }, 400);
  }

  const patch = parsed.data;
  if (Object.keys(patch).length === 0) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const existing = await loadEventSettingsRow(db, eventId);
  if (!existing) return c.json({ error: "not_found" }, 404);

  const audit = adminAuditFromContext(c);
  if (!audit.operator) return c.json({ error: "unauthorized" }, 401);

  const data: {
    title?: string;
    date?: Date;
    location?: string | null;
    capacity?: number | null;
  } = {};

  if (patch.title !== undefined) data.title = patch.title.trim();
  if (patch.date !== undefined) data.date = parseEventDateInput(patch.date);
  if (patch.location !== undefined) {
    data.location = patch.location?.trim() ? patch.location.trim() : null;
  }
  if (patch.capacity !== undefined) data.capacity = patch.capacity;

  const changedFields = Object.keys(data);

  try {
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.event.update({
        where: { id: eventId },
        data,
        select: {
          id: true,
          title: true,
          slug: true,
          date: true,
          location: true,
          capacity: true,
          archived_at: true,
          organization_id: true,
          organization: { select: { name: true } },
          event_items: {
            select: { id: true, label: true, enabled: true },
            orderBy: { label: "asc" },
          },
        },
      });

      await writeAdminAuditLog(tx, {
        organizationId: row.organization_id,
        actorUserId: audit.operator!,
        sessionId: audit.sessionId,
        ip: audit.ip,
        actionType: "event_updated",
        metadata: { eventId, fields: changedFields },
      });

      return row;
    });

    return c.json({ event: serializeEventSettings(updated) });
  } catch (err) {
    console.error("[audit] event_updated transaction failed", err);
    return c.json({ code: "audit_failed" }, 500);
  }
}

function sanitizeCsvCell(value: string | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

function quoteCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function exportContentDisposition(filename: string): string {
  const safeFilename = filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `attachment; filename="${safeFilename}"`;
}

const PII_EXPORT_MAX_ROWS = 10_000;

/** GET /api/admin/events/:eventId/export-pii — superadmin CSV of attendee PII. */
export async function handleExportEventPii(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const auth = c.get("auth");

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, slug: true, organization_id: true },
  });
  if (!event) return c.json({ error: "not_found" }, 404);

  const audit = adminAuditFromContext(c);
  if (!audit.operator) return c.json({ error: "unauthorized" }, 401);

  const totalCount = await db.attendee.count({ where: { event_id: eventId } });
  const truncated = totalCount > PII_EXPORT_MAX_ROWS;

  const attendees = await db.attendee.findMany({
    where: { event_id: eventId },
    take: PII_EXPORT_MAX_ROWS,
    orderBy: { created_at: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      company: true,
      department: true,
      ticket_type: true,
      admitted_at: true,
      custom_data: true,
    },
  });

  const columns = [
    "id",
    "name",
    "email",
    "company",
    "department",
    "ticket_type",
    "check_in_status",
    "admitted_at",
    "custom_data",
  ] as const;

  const header = columns.map((col) => quoteCsvCell(col)).join(",");
  const rows = attendees.map((row) => {
    const checkInStatus = row.admitted_at ? "admitted" : "not_admitted";
    const customData =
      row.custom_data != null && typeof row.custom_data === "object"
        ? JSON.stringify(row.custom_data)
        : "";
    return [
      row.id,
      row.name,
      row.email,
      row.company ?? "",
      row.department ?? "",
      row.ticket_type ?? "",
      checkInStatus,
      row.admitted_at?.toISOString() ?? "",
      customData,
    ]
      .map((cell) => quoteCsvCell(sanitizeCsvCell(String(cell))))
      .join(",");
  });

  const csvBody = [header, ...rows].join("\r\n");
  const bom = "\uFEFF";
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `pii-export-${event.slug}-${dateStamp}.csv`;

  await writeAdminAuditLog(db, {
    organizationId: event.organization_id,
    actorUserId: audit.operator,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType: "event_pii_exported",
    metadata: { eventId, rowCount: attendees.length, totalCount, truncated },
  });

  return new Response(bom + csvBody, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": exportContentDisposition(filename),
      ...(truncated
        ? {
            "X-Export-Truncated": "true",
            "X-Export-Total-Rows": String(totalCount),
            "X-Export-Returned-Rows": String(attendees.length),
          }
        : {}),
    },
  });
}
