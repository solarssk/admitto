import type { Context } from "hono";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { isReservedCustomDataSourceField, writeBulkActionLog } from "@admitto/tickets";
import { adminAuditFromContext, assertEventManageAccess, requireEventId } from "./admin-helpers.js";

/** Per-event cap on custom attendee data field definitions - same placement/rationale as
 * MAX_IMAGE_ASSETS_PER_EVENT (bounds growth, generous for real use). */
export const MAX_CUSTOM_FIELDS_PER_EVENT = 20;

/** Thrown when the per-event cap is still exceeded on the transaction-scoped recheck (two
 * concurrent creates could otherwise both pass the earlier, non-transactional count check before
 * either insert committed - same failure shape already fixed for event image assets). Caught
 * below and mapped to the same 422 response. */
class FieldLimitReachedError extends Error {}

/** Thrown when a delete's in-use recheck (inside the lock) finds an item reference that appeared
 * after the initial check. Caught below and mapped to the same 409 response. */
class FieldInUseError extends Error {}

/** Serializes create/delete for one event's custom-field registry against each other, and against
 * event-items-api-routes.ts's content_fields validation - without this, a concurrent "attach field
 * X to an item" and "delete field X" could interleave so the delete's in-use scan runs before the
 * item's write commits, leaving content_fields pointing at a source_field that no longer exists
 * (same pattern as acquireEventImageAssetsLock in event-image-assets-routes.ts). */
export async function acquireEventCustomFieldsLock(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<void> {
  const lockKey = `event-custom-fields:${eventId}`;
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
}

const slugField = z.string().trim().regex(/^[a-z0-9_]+$/, "invalid slug");

const createFieldSchema = z
  .object({
    source_field: slugField.min(1).max(60),
    label: z.string().trim().min(1).max(60),
    type: z.enum(["text", "select", "boolean"]).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  })
  .strict()
  .refine((row) => row.type !== "select" || (row.options != null && row.options.length > 0), {
    message: "select type requires options",
  })
  .refine((row) => !isReservedCustomDataSourceField(row.source_field), {
    message: "reserved source_field",
  });

/** `source_field` is immutable after create (same precedent as EventItem.key) - renaming a live
 * JSON key across every attendee's custom_data and every item's content_fields references is
 * exactly the migration-shaped problem worth avoiding rather than half-solving. */
const patchFieldSchema = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    type: z.enum(["text", "select", "boolean"]).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  })
  .strict()
  .refine((row) => row.type !== "select" || (row.options != null && row.options.length > 0), {
    message: "select type requires options",
  });

/** Admin API shape for a single event custom field. */
export type EventCustomFieldDto = {
  id: string;
  source_field: string;
  label: string;
  type: "text" | "select" | "boolean";
  required: boolean;
  options: string[] | null;
  created_at: string;
};

function serializeCustomField(row: {
  id: string;
  source_field: string;
  label: string;
  type: string;
  required: boolean;
  options: Prisma.JsonValue;
  created_at: Date;
}): EventCustomFieldDto {
  const options = Array.isArray(row.options)
    ? row.options.filter((o): o is string => typeof o === "string")
    : null;
  return {
    id: row.id,
    source_field: row.source_field,
    label: row.label,
    type: row.type as EventCustomFieldDto["type"],
    required: row.required,
    options: options && options.length > 0 ? options : null,
    created_at: row.created_at.toISOString(),
  };
}

/** GET /api/admin/events/:eventId/custom-fields */
export async function handleListEventCustomFields(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const rows = await db.eventCustomField.findMany({
    where: { event_id: eventId },
    orderBy: { created_at: "asc" },
  });

  return c.json({ items: rows.map(serializeCustomField) });
}

/** POST /api/admin/events/:eventId/custom-fields */
export async function handleCreateEventCustomField(c: Context, db: PrismaClient): Promise<Response> {
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

  const parsed = createFieldSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const count = await db.eventCustomField.count({ where: { event_id: eventId } });
  if (count >= MAX_CUSTOM_FIELDS_PER_EVENT) {
    return c.json(
      { error: "field_limit_reached", limit: MAX_CUSTOM_FIELDS_PER_EVENT },
      422,
    );
  }

  try {
    const created = await db.$transaction(async (tx) => {
      // Recheck the cap inside the transaction: the earlier count() above is a fast-path
      // rejection only and isn't race-safe on its own - two concurrent creates could both read a
      // count under the cap before either insert commits. The advisory lock serializes concurrent
      // transactions for the same event so the recount below is accurate (default Postgres
      // isolation is READ COMMITTED, not Serializable).
      await acquireEventCustomFieldsLock(tx, eventId);
      const recount = await tx.eventCustomField.count({ where: { event_id: eventId } });
      if (recount >= MAX_CUSTOM_FIELDS_PER_EVENT) {
        throw new FieldLimitReachedError();
      }
      const row = await tx.eventCustomField.create({
        data: {
          event_id: eventId,
          source_field: parsed.data.source_field,
          label: parsed.data.label,
          type: parsed.data.type ?? "text",
          required: parsed.data.required ?? false,
          options: parsed.data.options ?? Prisma.JsonNull,
        },
      });
      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "event_custom_field_created",
        audit: adminAuditFromContext(c),
        metadata: { source_field: row.source_field },
      });
      return row;
    });
    return c.json(serializeCustomField(created), 201);
  } catch (err) {
    if (err instanceof FieldLimitReachedError) {
      return c.json(
        { error: "field_limit_reached", limit: MAX_CUSTOM_FIELDS_PER_EVENT },
        422,
      );
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return c.json({ error: "source_field_conflict" }, 409);
    }
    throw err;
  }
}

/** Load a custom field scoped to event; null when missing or cross-event (caller returns 403). */
async function loadCustomFieldInEvent(db: PrismaClient, eventId: string, fieldId: string) {
  const row = await db.eventCustomField.findUnique({ where: { id: fieldId } });
  if (row?.event_id !== eventId) return null;
  return row;
}

/** PATCH /api/admin/events/:eventId/custom-fields/:fieldId */
export async function handlePatchEventCustomField(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const fieldId = c.req.param("fieldId");
  if (!fieldId) return c.json({ error: "fieldId required" }, 400);

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadCustomFieldInEvent(db, eventId, fieldId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = patchFieldSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const data: Prisma.EventCustomFieldUpdateInput = {};
  if (parsed.data.label !== undefined) data.label = parsed.data.label;
  if (parsed.data.type !== undefined) data.type = parsed.data.type;
  if (parsed.data.required !== undefined) data.required = parsed.data.required;
  if (parsed.data.options !== undefined) data.options = parsed.data.options;

  if (Object.keys(data).length === 0) {
    return c.json(serializeCustomField(existing));
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.eventCustomField.update({ where: { id: fieldId }, data });
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "event_custom_field_updated",
      audit: adminAuditFromContext(c),
      metadata: { source_field: row.source_field },
    });
    return row;
  });
  return c.json(serializeCustomField(updated));
}

/** DELETE /api/admin/events/:eventId/custom-fields/:fieldId — blocked (409 field_in_use) while
 * any of the event's items still reference this field via config.content_fields. Does not check
 * existing Attendee.custom_data, consistent with how deleting/reshaping an item today never
 * scrubs attendee data. */
export async function handleDeleteEventCustomField(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const fieldId = c.req.param("fieldId");
  if (!fieldId) return c.json({ error: "fieldId required" }, 400);

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadCustomFieldInEvent(db, eventId, fieldId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  try {
    await db.$transaction(async (tx) => {
      // The lock serializes against event-items-api-routes.ts's content_fields validation, which
      // takes the same lock before its own registry check + commit - without it, an item save
      // could commit a new content_fields reference between this scan and the delete below
      // (Postgres default isolation is READ COMMITTED, not Serializable).
      await acquireEventCustomFieldsLock(tx, eventId);

      const items = await tx.eventItem.findMany({
        where: { event_id: eventId },
        select: { config: true },
      });
      const inUse = items.some((item) => {
        const config = item.config;
        if (!config || typeof config !== "object" || Array.isArray(config)) return false;
        const fields = (config as { content_fields?: unknown }).content_fields;
        return Array.isArray(fields) && fields.includes(existing.source_field);
      });
      if (inUse) {
        throw new FieldInUseError();
      }

      await tx.eventCustomField.delete({ where: { id: fieldId } });
      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "event_custom_field_deleted",
        audit: adminAuditFromContext(c),
        metadata: { source_field: existing.source_field },
      });
    });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof FieldInUseError) {
      return c.json({ error: "field_in_use" }, 409);
    }
    throw err;
  }
}
