/**
 * Event settings: read/update basic fields and superadmin PII export (prompt 54).
 */
import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { canManageInstance } from "@admitto/auth";
import { REVOCABLE_ITEM_STATES, writeAdminAuditLog } from "@admitto/tickets";
import { InvalidHttpUrlError, resolveBrandingFromEvent, validateBrandingUrl } from "@admitto/mail-templates";
import { z } from "zod";
import { adminAuditFromContext, assertEventManageAccess, requireEventId } from "./admin-helpers.js";
import { sanitizeCsvCell } from "./csv-sanitize.js";
import { timezoneField } from "./timezone.js";
import { countEventActivitySignals, isEventDeletable } from "./event-deletion.js";

const dateOnlyField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => isValidCalendarDate(value), "Invalid date");

const PG_INT_MAX = 2_147_483_647;

/**
 * Strict schema: unknown keys (including `slug`) return 400 — slug is immutable and
 * clients must omit it; we do not silently strip extra fields.
 */
const patchEventSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    date: z.union([z.string().datetime(), dateOnlyField]).optional(),
    location: z.string().trim().max(300).nullish(),
    capacity: z.number().int().positive().max(PG_INT_MAX).nullish(),
    timezone: timezoneField.optional(),
    logo_url: z.string().trim().max(2000).nullish(),
    header_image_url: z.string().trim().max(2000).nullish(),
  })
  .strict();

export type EventSettingsDto = {
  id: string;
  title: string;
  slug: string;
  date: string;
  timezone: string;
  location: string | null;
  capacity: number | null;
  status: "active" | "archived";
  /** Null unless status is "archived". */
  archived_at: string | null;
  /** When the event was first created — shown in the Status card. */
  created_at: string;
  /** True when the event has zero real activity and can be permanently deleted. */
  is_deletable: boolean;
  /** Attendees currently checked in — drives the "Revoke all check-ins" Danger Zone row. */
  admitted_count: number;
  /** Individual issued/returned item hand-outs across all attendees — drives "Revoke all items issued". */
  issued_items_count: number;
  organization_name: string;
  active_items: Array<{ id: string; name: string; enabled: boolean }>;
  /** Event's own branding overrides — null means "inherited from organization". */
  logo_url: string | null;
  header_image_url: string | null;
  /** Effective branding actually used today (event value, else organization's). */
  resolved_logo_url: string | null;
  resolved_header_image_url: string | null;
};

type EventSettingsRow = {
  id: string;
  title: string;
  slug: string;
  date: Date;
  timezone: string;
  location: string | null;
  capacity: number | null;
  archived_at: Date | null;
  created_at: Date;
  logo_url: string | null;
  header_image_url: string | null;
  pinned_note: string | null;
  organization: { name: string; logo_url: string | null; header_image_url: string | null };
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

function serializeEventSettings(
  event: EventSettingsRow,
  deletability: { isDeletable: boolean },
  revokeCounts: { admittedCount: number; issuedItemsCount: number },
): EventSettingsDto {
  const resolved = resolveBrandingFromEvent(event);
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    date: event.date.toISOString(),
    timezone: event.timezone,
    location: event.location,
    capacity: event.capacity,
    status: event.archived_at ? "archived" : "active",
    archived_at: event.archived_at ? event.archived_at.toISOString() : null,
    created_at: event.created_at.toISOString(),
    is_deletable: deletability.isDeletable,
    admitted_count: revokeCounts.admittedCount,
    issued_items_count: revokeCounts.issuedItemsCount,
    organization_name: event.organization.name,
    active_items: event.event_items.map((item) => ({
      id: item.id,
      name: item.label,
      enabled: item.enabled,
    })),
    logo_url: event.logo_url,
    header_image_url: event.header_image_url,
    resolved_logo_url: resolved.logo_url || null,
    resolved_header_image_url: resolved.header_image_url || null,
  };
}

const EVENT_SETTINGS_SELECT = {
  id: true,
  title: true,
  slug: true,
  date: true,
  timezone: true,
  location: true,
  capacity: true,
  archived_at: true,
  created_at: true,
  pinned_note: true,
  organization_id: true,
  logo_url: true,
  header_image_url: true,
  organization: { select: { name: true, logo_url: true, header_image_url: true } },
  event_items: {
    select: { id: true, label: true, enabled: true },
    orderBy: { label: "asc" as const },
  },
} as const;

/** Load activity signals for an event and evaluate the shared delete guard against them. */
async function loadDeletability(
  db: PrismaClient,
  eventId: string,
  event: { archived_at: Date | null; pinned_note: string | null },
): Promise<{ isDeletable: boolean }> {
  const signals = await countEventActivitySignals(db, eventId);
  return { isDeletable: isEventDeletable(event, signals) };
}

/** Live counts backing the Danger Zone's "Revoke all check-ins" / "Revoke all items issued" rows. */
async function loadRevokeCounts(
  db: PrismaClient,
  eventId: string,
): Promise<{ admittedCount: number; issuedItemsCount: number }> {
  const [admittedCount, issuedItemsCount] = await Promise.all([
    db.attendee.count({ where: { event_id: eventId, admitted_at: { not: null } } }),
    db.attendeeItemState.count({
      where: { state: { in: REVOCABLE_ITEM_STATES }, event_item: { event_id: eventId } },
    }),
  ]);
  return { admittedCount, issuedItemsCount };
}

async function loadEventSettingsRow(
  db: PrismaClient,
  eventId: string,
): Promise<(EventSettingsRow & { organization_id: string }) | null> {
  return db.event.findUnique({
    where: { id: eventId },
    select: EVENT_SETTINGS_SELECT,
  });
}

/** GET /api/admin/events/:eventId/settings */
export async function handleGetEventSettings(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const event = await loadEventSettingsRow(db, eventId);
  if (!event) return c.json({ error: "not_found" }, 404);

  const [deletability, revokeCounts] = await Promise.all([
    loadDeletability(db, eventId, event),
    loadRevokeCounts(db, eventId),
  ]);
  return c.json(serializeEventSettings(event, deletability, revokeCounts));
}

type PatchEventBody = z.infer<typeof patchEventSchema>;

/** Maps the schema's basic (non-branding) fields onto Prisma update data. */
function buildBasicFieldsPatch(patch: PatchEventBody): {
  title?: string;
  date?: Date;
  timezone?: string;
  location?: string | null;
  capacity?: number | null;
} {
  const data: ReturnType<typeof buildBasicFieldsPatch> = {};
  if (patch.title !== undefined) data.title = patch.title.trim();
  if (patch.date !== undefined) data.date = parseEventDateInput(patch.date);
  if (patch.timezone !== undefined) data.timezone = patch.timezone;
  if (patch.location !== undefined) {
    data.location = patch.location?.trim() ? patch.location.trim() : null;
  }
  if (patch.capacity !== undefined) data.capacity = patch.capacity;
  return data;
}

/** Validates and writes patch.logo_url/header_image_url into `data`; returns an error Response, or null on success. */
function applyBrandingPatch(
  c: Context,
  data: { logo_url?: string | null; header_image_url?: string | null },
  patch: PatchEventBody,
): Response | null {
  try {
    if (patch.logo_url !== undefined) {
      const trimmed = patch.logo_url?.trim() ?? "";
      data.logo_url = trimmed ? validateBrandingUrl("logo_url", trimmed) : null;
    }
    if (patch.header_image_url !== undefined) {
      const trimmed = patch.header_image_url?.trim() ?? "";
      data.header_image_url = trimmed ? validateBrandingUrl("header_image_url", trimmed) : null;
    }
    return null;
  } catch (err) {
    if (err instanceof InvalidHttpUrlError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
}

/** PATCH /api/admin/events/:eventId — basic fields only (archive guard applied upstream). */
export async function handlePatchEvent(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

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

  const data: {
    title?: string;
    date?: Date;
    timezone?: string;
    location?: string | null;
    capacity?: number | null;
    logo_url?: string | null;
    header_image_url?: string | null;
  } = buildBasicFieldsPatch(patch);

  const brandingError = applyBrandingPatch(c, data, patch);
  if (brandingError) return brandingError;

  const changedFields = Object.keys(data);

  try {
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.event.update({
        where: { id: eventId },
        data,
        select: EVENT_SETTINGS_SELECT,
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

    const deletability = await loadDeletability(db, eventId, updated);
    const revokeCounts = await loadRevokeCounts(db, eventId);
    return c.json({ event: serializeEventSettings(updated, deletability, revokeCounts) });
  } catch (err) {
    console.error("[audit] event_updated transaction failed", err);
    return c.json({ error: "audit_failed" }, 500);
  }
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

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, slug: true, organization_id: true },
  });
  if (!event) return c.json({ error: "not_found" }, 404);

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

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
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
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
