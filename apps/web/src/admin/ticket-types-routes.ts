import type { Context } from "hono";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { TICKET_TYPE_COLOR_KEYS, uniqueTicketTypeKey, writeBulkActionLog } from "@admitto/tickets";
import { adminAuditFromContext, assertEventManageAccess, requireEventId } from "./admin-helpers.js";

/** Per-event cap on ticket types - same placement/rationale as MAX_CUSTOM_FIELDS_PER_EVENT. */
export const MAX_TICKET_TYPES_PER_EVENT = 20;

/** Thrown when the per-event cap is still exceeded on the transaction-scoped recheck (same
 * concurrent-create race guarded in event-custom-fields-routes.ts). Caught below, mapped to 422. */
class TypeLimitReachedError extends Error {}

/** Thrown when a delete's in-use recheck (inside the lock) finds an attendee reference that
 * appeared after the initial check. Caught below and mapped to the same 409 response. */
class TypeInUseError extends Error {}

/** Serializes create/delete for one event's ticket-type catalog against each other, closing the
 * same concurrent-create-vs-cap race as acquireEventCustomFieldsLock. */
async function acquireEventTicketTypesLock(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  const lockKey = `ticket-types:${eventId}`;
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
}

const colorField = z.enum(TICKET_TYPE_COLOR_KEYS);

const createTypeSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    color: colorField.optional(),
  })
  .strict();

/** `key` is immutable after create (same precedent as EventCustomField.source_field) - it's what
 * Attendee.ticket_type stores, so renaming it would desync every attendee already tagged with it. */
const patchTypeSchema = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    color: colorField.optional(),
  })
  .strict();

/** Admin API shape for a single event ticket type. */
export type TicketTypeDto = {
  id: string;
  key: string;
  label: string;
  color: string;
  sort_order: number;
  attendee_count: number;
  created_at: string;
};

function serializeTicketType(
  row: { id: string; key: string; label: string; color: string; sort_order: number; created_at: Date },
  attendeeCount: number,
): TicketTypeDto {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    color: row.color,
    sort_order: row.sort_order,
    attendee_count: attendeeCount,
    created_at: row.created_at.toISOString(),
  };
}

/** Shared by the admin and check-in GET routes below - one groupBy for a live attendee count per
 * type, same shape as reports-routes.ts's by-ticket-type aggregate. */
async function loadTicketTypesWithCounts(db: PrismaClient, eventId: string): Promise<TicketTypeDto[]> {
  const [rows, counts] = await Promise.all([
    db.ticketType.findMany({ where: { event_id: eventId }, orderBy: { sort_order: "asc" } }),
    db.attendee.groupBy({
      by: ["ticket_type"],
      where: { event_id: eventId, ticket_type: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const countByKey = new Map(counts.map((row) => [row.ticket_type, row._count._all]));
  return rows.map((row) => serializeTicketType(row, countByKey.get(row.key) ?? 0));
}

/** GET /api/admin/events/:eventId/ticket-types - the Event Settings tab's own round trip. */
export async function handleListEventTicketTypes(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  return c.json({ items: await loadTicketTypesWithCounts(db, eventId) });
}

/** GET /api/checkin/ticket-types - the same catalog as the admin route above, but reachable by
 * check-in operators, who often don't hold admin-panel access and would otherwise 403 on
 * assertEventManageAccess; the check-in card and scan result panel need this to resolve badge
 * label/color instead of falling back to a raw key in gray (Codex review, batch 04 / #351). */
export async function handleCheckinTicketTypes(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = c.req.query("eventId");
  if (!eventId) return c.json({ error: "eventId required" }, 400);

  return c.json({ items: await loadTicketTypesWithCounts(db, eventId) });
}

/** POST /api/admin/events/:eventId/ticket-types - server derives `key` from `label` (dedupe with
 * a numeric suffix within the event, same as uniqueItemKey for EventItem keys). */
export async function handleCreateEventTicketType(c: Context, db: PrismaClient): Promise<Response> {
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

  const parsed = createTypeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const count = await db.ticketType.count({ where: { event_id: eventId } });
  if (count >= MAX_TICKET_TYPES_PER_EVENT) {
    return c.json({ error: "type_limit_reached", limit: MAX_TICKET_TYPES_PER_EVENT }, 422);
  }

  try {
    const created = await db.$transaction(async (tx) => {
      // Recheck the cap inside the transaction - same rationale as
      // event-custom-fields-routes.ts's recount (default Postgres isolation is READ COMMITTED,
      // not Serializable, so two concurrent creates could both pass the count() above).
      await acquireEventTicketTypesLock(tx, eventId);
      const recount = await tx.ticketType.count({ where: { event_id: eventId } });
      if (recount >= MAX_TICKET_TYPES_PER_EVENT) {
        throw new TypeLimitReachedError();
      }
      const existing = await tx.ticketType.findMany({
        where: { event_id: eventId },
        select: { key: true, sort_order: true },
      });
      const nextSortOrder = existing.reduce((max, row) => Math.max(max, row.sort_order + 1), 0);
      const row = await tx.ticketType.create({
        data: {
          event_id: eventId,
          key: uniqueTicketTypeKey(parsed.data.label, existing.map((row) => row.key)),
          label: parsed.data.label,
          color: parsed.data.color ?? "gray",
          sort_order: nextSortOrder,
        },
      });
      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "ticket_type_created",
        audit: adminAuditFromContext(c),
        metadata: { key: row.key },
      });
      return row;
    });
    return c.json(serializeTicketType(created, 0), 201);
  } catch (err) {
    if (err instanceof TypeLimitReachedError) {
      return c.json({ error: "type_limit_reached", limit: MAX_TICKET_TYPES_PER_EVENT }, 422);
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return c.json({ error: "key_conflict" }, 409);
    }
    throw err;
  }
}

/** Load a ticket type scoped to event; null when missing or cross-event (caller returns 403). */
async function loadTicketTypeInEvent(db: PrismaClient, eventId: string, typeId: string) {
  const row = await db.ticketType.findUnique({ where: { id: typeId } });
  if (row?.event_id !== eventId) return null;
  return row;
}

/** PATCH /api/admin/events/:eventId/ticket-types/:typeId */
export async function handlePatchEventTicketType(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const typeId = c.req.param("typeId");
  if (!typeId) return c.json({ error: "typeId required" }, 400);

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadTicketTypeInEvent(db, eventId, typeId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = patchTypeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const data: Prisma.TicketTypeUpdateInput = {};
  if (parsed.data.label !== undefined) data.label = parsed.data.label;
  if (parsed.data.color !== undefined) data.color = parsed.data.color;

  if (Object.keys(data).length === 0) {
    const counts = await db.attendee.count({ where: { event_id: eventId, ticket_type: existing.key } });
    return c.json(serializeTicketType(existing, counts));
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.ticketType.update({ where: { id: typeId }, data });
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "ticket_type_updated",
      audit: adminAuditFromContext(c),
      metadata: { key: row.key },
    });
    return row;
  });
  const counts = await db.attendee.count({ where: { event_id: eventId, ticket_type: updated.key } });
  return c.json(serializeTicketType(updated, counts));
}

/** DELETE /api/admin/events/:eventId/ticket-types/:typeId - blocked (409 type_in_use) while any
 * attendee still has this type. */
export async function handleDeleteEventTicketType(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const typeId = c.req.param("typeId");
  if (!typeId) return c.json({ error: "typeId required" }, 400);

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadTicketTypeInEvent(db, eventId, typeId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  try {
    await db.$transaction(async (tx) => {
      // The lock serializes against concurrent creates on this event; the in-use recheck below
      // still needs its own fresh read since a concurrent attendee write isn't blocked by this
      // lock (only other ticket-type mutations are) - same READ COMMITTED caveat as custom-fields.
      await acquireEventTicketTypesLock(tx, eventId);

      const inUseCount = await tx.attendee.count({ where: { event_id: eventId, ticket_type: existing.key } });
      if (inUseCount > 0) {
        throw new TypeInUseError();
      }

      await tx.ticketType.delete({ where: { id: typeId } });
      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "ticket_type_deleted",
        audit: adminAuditFromContext(c),
        metadata: { key: existing.key },
      });
    });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof TypeInUseError) {
      return c.json({ error: "type_in_use" }, 409);
    }
    throw err;
  }
}
