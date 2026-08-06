/**
 * Event settings: read/update basic fields and superadmin PII export (prompt 54).
 */
import type { Context } from "hono";
import { Prisma, type PrismaClient } from "@admitto/db";
import { canManageInstance } from "@admitto/auth";
import { ADMITTABLE_STATUS_LIST, REVOCABLE_ITEM_STATES, writeAdminAuditLog } from "@admitto/tickets";
import {
  InvalidHttpUrlError,
  logoCropFromDb,
  parseLogoCrop,
  resolveBrandingFromEvent,
  validateBrandingUrl,
  enforceLogoPersistenceForDisplayChange,
  type BrandingUpdateData,
  type EventSettingsDto,
  type LogoCropMeta,
} from "@admitto/mail-templates";
import { emitSystemLog, recordSystemLog } from "@admitto/shared/system-log";
import { z } from "zod";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  eventHoursField,
  isValidCalendarDate,
  parseEventDateInput,
  requireEventId,
  resolveActorEmailForLog,
} from "./admin-helpers.js";
import { quoteCsvCell, sanitizeCsvCell } from "./csv-sanitize.js";
import { timezoneField } from "./timezone.js";
import { countEventActivitySignals, isEventDeletable } from "./event-deletion.js";
import { attachmentContentDisposition } from "./content-disposition.js";
import { bestEffortDeleteReplacedUploadUrls } from "./branding-upload.js";
import { isManagedUploadUrlReferenced } from "./branding-upload-refs.js";

const dateOnlyField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => isValidCalendarDate(value), "Invalid date");

const PG_INT_MAX = 2_147_483_647;

/** Shape-only gate; bounds/zoom rules live in `parseLogoCrop` (called after this parses). */
const logoCropSchema = z
  .object({
    unit: z.literal("%"),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
    zoom: z.number().finite(),
  })
  .nullish();

/**
 * Strict schema: unknown keys (including `slug`) return 400 - slug is immutable and
 * clients must omit it; we do not silently strip extra fields.
 */
const patchEventSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    date: z.union([z.string().datetime(), dateOnlyField]).optional(),
    capacity: z.number().int().positive().max(PG_INT_MAX).nullish(),
    timezone: timezoneField.optional(),
    event_hours_start: eventHoursField,
    event_hours_end: eventHoursField,
    logo_url: z.string().trim().max(2000).nullish(),
    logo_original_url: z.string().trim().max(2000).nullish(),
    logo_crop: logoCropSchema,
    header_image_url: z.string().trim().max(2000).nullish(),
  })
  .strict();

export type { EventSettingsDto };

type EventSettingsRow = {
  id: string;
  title: string;
  slug: string;
  date: Date;
  timezone: string;
  event_hours_start: string | null;
  event_hours_end: string | null;
  capacity: number | null;
  archived_at: Date | null;
  archived_by_timezone: string | null;
  created_at: Date;
  created_by_timezone: string | null;
  logo_url: string | null;
  logo_original_url: string | null;
  logo_crop: unknown;
  header_image_url: string | null;
  pinned_note: string | null;
  organization: { name: string; logo_url: string | null; header_image_url: string | null };
  event_items: Array<{ id: string; label: string; enabled: boolean }>;
};

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
    event_hours_start: event.event_hours_start,
    event_hours_end: event.event_hours_end,
    capacity: event.capacity,
    status: event.archived_at ? "archived" : "active",
    archived_at: event.archived_at ? event.archived_at.toISOString() : null,
    archived_by_timezone: event.archived_by_timezone,
    created_at: event.created_at.toISOString(),
    created_by_timezone: event.created_by_timezone,
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
    logo_original_url: event.logo_original_url,
    logo_crop: logoCropFromDb(event.logo_crop),
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
  event_hours_start: true,
  event_hours_end: true,
  capacity: true,
  archived_at: true,
  archived_by_timezone: true,
  created_at: true,
  created_by_timezone: true,
  pinned_note: true,
  organization_id: true,
  logo_url: true,
  logo_original_url: true,
  logo_crop: true,
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

/** Live counts backing the Danger Zone's "Revoke all check-ins" / "Revoke all items issued" rows.
 * Both are scoped to attendees whose pass is still admittable: revokeAllCheckInsForEvent's
 * resetItems:true cascade and revokeAllItemsForEvent both skip a blocked (revoked/cancelled)
 * attendee via the same isAdmittable guard the single-item actions enforce (bot review) - an
 * admitted-but-blocked attendee's check-in revoke rolls back entirely rather than clearing, so
 * counting them here would show/enable a Danger Zone row for attendees/items the bulk action can
 * never actually revoke. */
async function loadRevokeCounts(
  db: PrismaClient,
  eventId: string,
): Promise<{ admittedCount: number; issuedItemsCount: number }> {
  const [admittedCount, issuedItemsCount] = await Promise.all([
    db.attendee.count({
      where: {
        event_id: eventId,
        admitted_at: { not: null },
        status: { in: ADMITTABLE_STATUS_LIST },
      },
    }),
    db.attendeeItemState.count({
      where: {
        state: { in: REVOCABLE_ITEM_STATES },
        event_item: { event_id: eventId },
        attendee: { status: { in: ADMITTABLE_STATUS_LIST } },
      },
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
  event_hours_start?: string | null;
  event_hours_end?: string | null;
  capacity?: number | null;
} {
  const data: ReturnType<typeof buildBasicFieldsPatch> = {};
  if (patch.title !== undefined) data.title = patch.title.trim();
  if (patch.date !== undefined) data.date = parseEventDateInput(patch.date);
  if (patch.timezone !== undefined) data.timezone = patch.timezone;
  if (patch.event_hours_start !== undefined) data.event_hours_start = patch.event_hours_start;
  if (patch.event_hours_end !== undefined) data.event_hours_end = patch.event_hours_end;
  if (patch.capacity !== undefined) data.capacity = patch.capacity;
  return data;
}

type BrandingPatchData = BrandingUpdateData;

function patchOptionalBrandingUrl(
  field: "logo_url" | "logo_original_url" | "header_image_url",
  raw: string | null | undefined,
  data: BrandingPatchData,
): void {
  const trimmed = raw?.trim() ?? "";
  data[field] = trimmed ? validateBrandingUrl(field, trimmed) : null;
}

/** External or cleared display logo cannot keep an upload original / crop. */
function clearOriginalWhenDisplayIsNotUpload(
  data: BrandingPatchData,
  patch: PatchEventBody,
): void {
  enforceLogoPersistenceForDisplayChange(data, {
    logoUrl: patch.logo_url,
    logoOriginalUrl: patch.logo_original_url,
    logoCrop: patch.logo_crop,
  });
}

function brandingPatchErrorResponse(c: Context, err: unknown): Response | null {
  if (err instanceof InvalidHttpUrlError) {
    return c.json({ error: err.message }, 400);
  }
  if (err instanceof Error && err.message.startsWith("logo_crop")) {
    return c.json({ error: err.message }, 400);
  }
  return null;
}

/** Validates and writes branding URL / crop fields into `data`; returns an error Response, or null. */
function applyBrandingPatch(
  c: Context,
  data: BrandingPatchData,
  patch: PatchEventBody,
): Response | null {
  try {
    if (patch.logo_url !== undefined) {
      patchOptionalBrandingUrl("logo_url", patch.logo_url, data);
    }
    if (patch.logo_original_url !== undefined) {
      patchOptionalBrandingUrl("logo_original_url", patch.logo_original_url, data);
    }
    if (patch.logo_crop !== undefined) {
      const crop = parseLogoCrop(patch.logo_crop ?? null);
      data.logo_crop = crop === null ? Prisma.JsonNull : crop;
    }
    if (patch.header_image_url !== undefined) {
      patchOptionalBrandingUrl("header_image_url", patch.header_image_url, data);
    }
    clearOriginalWhenDisplayIsNotUpload(data, patch);
    return null;
  } catch (err) {
    const response = brandingPatchErrorResponse(c, err);
    if (response) return response;
    throw err;
  }
}

/** PATCH /api/admin/events/:eventId - basic fields only (archive guard applied upstream). */
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
  const actorUserId = c.get("auth").userId;

  const data: {
    title?: string;
    date?: Date;
    timezone?: string;
    event_hours_start?: string | null;
    event_hours_end?: string | null;
    capacity?: number | null;
    logo_url?: string | null;
    logo_original_url?: string | null;
    logo_crop?: LogoCropMeta | typeof Prisma.JsonNull;
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
        actorUserId,
        sessionId: audit.sessionId,
        ip: audit.ip,
        timezone: audit.timezone,
        actionType: "event_updated",
        metadata: { eventId, fields: changedFields },
      });

      return row;
    });

    emitSystemLog("admin", "info", "event_updated", {
      eventId,
      fields: changedFields,
      actorUserId,
      actorEmail: await resolveActorEmailForLog(db, actorUserId),
    });

    // Interim orphan cleanup (ADR 0008): drop replaced/cleared managed upload files.
    await bestEffortDeleteReplacedUploadUrls(
      [existing.logo_url, existing.logo_original_url, existing.header_image_url],
      [updated.logo_url, updated.logo_original_url, updated.header_image_url],
      { expectedOrgId: "default", expectedKind: "event", expectedEventId: eventId },
      { isStillReferenced: (url) => isManagedUploadUrlReferenced(db, url) },
    );

    const deletability = await loadDeletability(db, eventId, updated);
    const revokeCounts = await loadRevokeCounts(db, eventId);
    return c.json({ event: serializeEventSettings(updated, deletability, revokeCounts) });
  } catch (err) {
    console.error("[audit] event_updated transaction failed", err);
    recordSystemLog({
      level: "error",
      source: "admin",
      message: "event_updated_failed",
      fields: { eventId, fields: changedFields, actorUserId, errorKind: "transaction" },
    });
    return c.json({ error: "audit_failed" }, 500);
  }
}

const PII_EXPORT_MAX_ROWS = 10_000;

/** GET /api/admin/events/:eventId/export-pii - superadmin CSV of attendee PII. */
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
  const dateStamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const filename = `pii-export-${event.slug}-${dateStamp}.csv`;

  await writeAdminAuditLog(db, {
    organizationId: event.organization_id,
    actorUserId: audit.operator,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "event_pii_exported",
    metadata: { eventId, rowCount: attendees.length, totalCount, truncated },
  });

  return new Response(bom + csvBody, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachmentContentDisposition(filename),
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
