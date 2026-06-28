import type { Context } from "hono";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  DEFAULT_EVENT_ITEM_KEYS,
  parseEventOpsConfig,
  resolveEventItemContents,
  writeBulkActionLog,
  type EventItemConfig,
} from "@admitto/tickets";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  requireEventId,
} from "./admin-helpers.js";

const slugField = z.string().trim().regex(/^[a-z0-9_]+$/, "invalid slug");

const iconNameSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^[a-z0-9-]+$/, "invalid icon");

const eventItemContentSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    source_field: slugField.min(1).max(60),
    type: z.enum(["text", "select", "boolean"]).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  })
  .strict()
  .refine(
    (row) => row.type !== "select" || (row.options != null && row.options.length > 0),
    { message: "select type requires options" },
  );

const eventItemConfigSchema = z
  .object({
    contents: z.array(eventItemContentSchema).max(20).optional(),
    requires_return: z.boolean().optional(),
    issue_on_checkin: z.boolean().optional(),
  })
  .strict()
  .refine(
    (cfg) => {
      if (!cfg.contents?.length) return true;
      const slugs = cfg.contents.map((c) => c.source_field);
      return new Set(slugs).size === slugs.length;
    },
    { message: "duplicate source_field" },
  );

const createEventItemSchema = z
  .object({
    key: slugField.min(1).max(60),
    label: z.string().trim().min(1).max(100),
    icon: iconNameSchema.optional(),
    config: eventItemConfigSchema.optional(),
  })
  .strict();

const patchEventItemSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
    icon: z
      .union([iconNameSchema, z.literal(""), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    config: eventItemConfigSchema.optional(),
  })
  .strict();

const patchOpsConfigSchema = z
  .object({
    require_confirm_on_scan: z.boolean().optional(),
    badge_at_entry: z.boolean().optional(),
    allow_manual_lookup: z.boolean().optional(),
    auto_advance_on_valid: z.boolean().optional(),
  })
  .strict();

/** Admin API shape for a single event item row. */
export type EventItemDto = {
  id: string;
  key: string;
  label: string;
  type: string;
  enabled: boolean;
  icon: string | null;
  config: EventItemConfig | null;
};

/** Normalize stored JSON config for API responses (strict fields + legacy contents). */
function serializeEventItemConfig(raw: unknown): EventItemConfig | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const parsed = eventItemConfigSchema.safeParse({
    contents: o.contents,
    requires_return: o.requires_return,
    issue_on_checkin: o.issue_on_checkin,
  });
  const config: EventItemConfig = parsed.success ? { ...parsed.data } : {};
  if (parsed.success && parsed.data.contents?.length) {
    config.contents = parsed.data.contents;
  } else {
    const resolved = resolveEventItemContents(raw);
    if (resolved.length > 0) {
      config.contents = resolved;
    }
  }
  return Object.keys(config).length > 0 ? config : null;
}

/** Map a Prisma EventItem row to the admin API DTO. */
function serializeEventItem(row: {
  id: string;
  key: string;
  label: string;
  type: string;
  enabled: boolean;
  icon: string | null;
  config: unknown;
}): EventItemDto {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type,
    enabled: row.enabled,
    icon: row.icon ?? null,
    config: serializeEventItemConfig(row.config),
  };
}

/** Require `:itemId` route param or return 400. */
function requireItemId(c: Context): string | Response {
  const itemId = c.req.param("itemId");
  if (!itemId) return c.json({ error: "itemId required" }, 400);
  return itemId;
}

/** Load event item scoped to event; null when missing or cross-event (caller returns 403). */
async function loadEventItemInEvent(db: PrismaClient, eventId: string, itemId: string) {
  const row = await db.eventItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      event_id: true,
      key: true,
      label: true,
      type: true,
      enabled: true,
      icon: true,
      config: true,
    },
  });
  if (!row || row.event_id !== eventId) return null;
  return row;
}

/** Count attendee rows where the item was actually issued or returned (not synthetic pending). */
async function countIssuedOrReturnedStates(
  db: PrismaClient | Prisma.TransactionClient,
  itemId: string,
): Promise<number> {
  return db.attendeeItemState.count({
    where: {
      event_item_id: itemId,
      state: { in: ["issued", "returned"] },
    },
  });
}

/** GET /api/admin/events/:eventId/items */
export async function handleListEventItems(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const rows = await db.eventItem.findMany({
    where: { event_id: eventId },
    orderBy: { key: "asc" },
    select: {
      id: true,
      key: true,
      label: true,
      type: true,
      enabled: true,
      icon: true,
      config: true,
    },
  });

  return c.json({ items: rows.map(serializeEventItem) });
}

/** POST /api/admin/events/:eventId/items */
export async function handleCreateEventItem(c: Context, db: PrismaClient): Promise<Response> {
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

  const parsed = createEventItemSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  try {
    const row = await db.$transaction(async (tx) => {
      const created = await tx.eventItem.create({
        data: {
          event_id: eventId,
          key: parsed.data.key,
          label: parsed.data.label,
          type: "item",
          enabled: true,
          icon: parsed.data.icon ?? null,
          config: (parsed.data.config ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        select: {
          id: true,
          key: true,
          label: true,
          type: true,
          enabled: true,
          icon: true,
          config: true,
        },
      });

      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "event_item_created",
        audit: adminAuditFromContext(c),
        metadata: { item_key: created.key },
      });

      return created;
    });

    return c.json(serializeEventItem(row), 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return c.json({ error: "key_conflict" }, 409);
    }
    console.error("handleCreateEventItem failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** PATCH /api/admin/events/:eventId/items/:itemId */
export async function handlePatchEventItem(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const itemIdOrRes = requireItemId(c);
  if (itemIdOrRes instanceof Response) return itemIdOrRes;
  const itemId = itemIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadEventItemInEvent(db, eventId, itemId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = patchEventItemSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const fields: string[] = [];
  const data: Prisma.EventItemUpdateInput = {};

  if (parsed.data.label !== undefined && parsed.data.label !== existing.label) {
    data.label = parsed.data.label;
    fields.push("label");
  }
  if (parsed.data.enabled !== undefined && parsed.data.enabled !== existing.enabled) {
    data.enabled = parsed.data.enabled;
    fields.push("enabled");
  }
  if (parsed.data.config !== undefined) {
    data.config = parsed.data.config as Prisma.InputJsonValue;
    fields.push("config");
  }
  if (parsed.data.icon !== undefined && parsed.data.icon !== existing.icon) {
    data.icon = parsed.data.icon;
    fields.push("icon");
  }

  if (fields.length === 0) {
    return c.json(serializeEventItem(existing));
  }

  const disabling = parsed.data.enabled === false && existing.enabled;

  const result = await db.$transaction(
    async (tx) => {
      if (disabling) {
        const inUse = await countIssuedOrReturnedStates(tx, itemId);
        if (inUse > 0) return { ok: false as const, reason: "in_use" as const };
      }

      const row = await tx.eventItem.update({
        where: { id: itemId },
        data,
        select: {
          id: true,
          key: true,
          label: true,
          type: true,
          enabled: true,
          icon: true,
          config: true,
        },
      });

      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "event_item_updated",
        audit: adminAuditFromContext(c),
        metadata: { item_key: row.key, fields },
      });

      return { ok: true as const, row };
    },
    disabling
      ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      : undefined,
  );

  if (!result.ok) {
    return c.json({ error: "item_in_use" }, 409);
  }

  return c.json(serializeEventItem(result.row));
}

/** DELETE /api/admin/events/:eventId/items/:itemId */
export async function handleDeleteEventItem(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const itemIdOrRes = requireItemId(c);
  if (itemIdOrRes instanceof Response) return itemIdOrRes;
  const itemId = itemIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadEventItemInEvent(db, eventId, itemId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  if (DEFAULT_EVENT_ITEM_KEYS.has(existing.key)) {
    return c.json({ error: "default_item_not_deletable" }, 409);
  }

  const deleted = await db.$transaction(async (tx) => {
    const inUse = await countIssuedOrReturnedStates(tx, itemId);
    if (inUse > 0) return { ok: false as const, reason: "in_use" as const };

    await tx.eventItem.delete({ where: { id: itemId } });
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "event_item_deleted",
      audit: adminAuditFromContext(c),
      metadata: { item_key: existing.key },
    });
    return { ok: true as const };
  });

  if (!deleted.ok) {
    return c.json({ error: "item_in_use" }, 409);
  }

  return c.json({ ok: true });
}

/** GET /api/admin/events/:eventId/ops-config */
export async function handleGetEventOpsConfig(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { ops_config: true },
  });
  if (!event) return c.json({ error: "forbidden" }, 403);

  return c.json(parseEventOpsConfig(event.ops_config));
}

/** PATCH /api/admin/events/:eventId/ops-config */
export async function handlePatchEventOpsConfig(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { ops_config: true },
  });
  if (!event) return c.json({ error: "forbidden" }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = patchOpsConfigSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const current = parseEventOpsConfig(event.ops_config);
  const next = {
    require_confirm_on_scan:
      parsed.data.require_confirm_on_scan ?? current.require_confirm_on_scan,
    badge_at_entry: parsed.data.badge_at_entry ?? current.badge_at_entry,
    allow_manual_lookup: parsed.data.allow_manual_lookup ?? current.allow_manual_lookup,
    auto_advance_on_valid: parsed.data.auto_advance_on_valid ?? current.auto_advance_on_valid,
  };

  const fields: string[] = [];
  if (parsed.data.require_confirm_on_scan !== undefined) fields.push("require_confirm_on_scan");
  if (parsed.data.badge_at_entry !== undefined) fields.push("badge_at_entry");
  if (parsed.data.allow_manual_lookup !== undefined) fields.push("allow_manual_lookup");
  if (parsed.data.auto_advance_on_valid !== undefined) fields.push("auto_advance_on_valid");

  if (fields.length === 0) {
    return c.json(current);
  }

  await db.$transaction(async (tx) => {
    await tx.event.update({
      where: { id: eventId },
      data: { ops_config: next as Prisma.InputJsonValue },
    });
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "ops_config_updated",
      audit: adminAuditFromContext(c),
      metadata: { fields },
    });
  });

  return c.json(next);
}
