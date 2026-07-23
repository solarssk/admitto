import type { Context } from "hono";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  ensureBadgeEventItem,
  isBadgeItemUsable,
  parseEventOpsConfig,
  writeBulkActionLog,
  loadEventCustomDataFields,
  validateContentFieldReferences,
  UnknownContentFieldError,
  type EventItemConfig,
} from "@admitto/tickets";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  requireEventId,
} from "./admin-helpers.js";
import { acquireEventCustomFieldsLock } from "./event-custom-fields-routes.js";

const slugField = z.string().trim().regex(/^[a-z0-9_]+$/, "invalid slug");

  // eslint-disable-next-line security/detect-unsafe-regex -- bounded input; validated pattern
const tablerIconNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const iconNameSchema = z
  .string()
  .trim()
  .max(64)
  .regex(tablerIconNamePattern, "invalid icon");

/** null and explicit "package" both mean the default icon at display time — store null. */
function normalizeEventItemIconForStorage(
  icon: string | null | undefined,
): string | null | undefined {
  if (icon === undefined) return undefined;
  if (icon === null || icon === "package") return null;
  return icon;
}

const eventItemConfigSchema = z
  .object({
    content_fields: z.array(slugField.min(1).max(60)).max(20).optional(),
    requires_return: z.boolean().optional(),
    issue_on_checkin: z.boolean().optional(),
  })
  .strict()
  .refine(
    (cfg) => {
      if (!cfg.content_fields?.length) return true;
      return new Set(cfg.content_fields).size === cfg.content_fields.length;
    },
    { message: "duplicate content_field" },
  );

const createEventItemSchema = z
  .object({
    key: slugField.min(1).max(60),
    label: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional().transform((v) => v || null),
    icon: iconNameSchema.optional().transform((icon) => normalizeEventItemIconForStorage(icon)),
    config: eventItemConfigSchema.optional(),
  })
  .strict();

const patchEventItemSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    description: z
      .union([z.string().trim().max(500), z.null()])
      .optional()
      .transform((v) => (v === undefined ? undefined : v || null)),
    enabled: z.boolean().optional(),
    icon: z
      .union([iconNameSchema, z.literal(""), z.null()])
      .optional()
      .transform((v) => {
        if (v === undefined) return undefined;
        if (v === "") return null;
        return normalizeEventItemIconForStorage(v);
      }),
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
  description: string | null;
  type: string;
  enabled: boolean;
  icon: string | null;
  config: EventItemConfig | null;
};

/** Normalize stored JSON config for API responses. */
function serializeEventItemConfig(raw: unknown): EventItemConfig | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const parsed = eventItemConfigSchema.safeParse({
    content_fields: o.content_fields,
    requires_return: o.requires_return,
    issue_on_checkin: o.issue_on_checkin,
  });
  if (!parsed.success) return null;
  // parsed.data always has all 3 keys, even when a value is `undefined` - Object.keys() would
  // never see it as empty, so filter those out before deciding whether anything is actually set.
  const defined = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  ) as EventItemConfig;
  return Object.keys(defined).length > 0 ? defined : null;
}

/** Map a Prisma EventItem row to the admin API DTO. */
function serializeEventItem(row: {
  id: string;
  key: string;
  label: string;
  description: string | null;
  type: string;
  enabled: boolean;
  icon: string | null;
  config: unknown;
}): EventItemDto {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description ?? null,
    type: row.type,
    enabled: row.enabled,
    icon: row.icon ?? null,
    config: serializeEventItemConfig(row.config),
  };
}

/** Rejects config.content_fields entries that don't exist in the event's EventCustomField
 * registry - throws UnknownContentFieldError on an unknown reference, caught by the caller and
 * mapped to a 400. Takes a transaction client so the caller can run this after
 * acquireEventCustomFieldsLock, serializing against a concurrent field delete (see
 * event-custom-fields-routes.ts) - without that, a field could be deleted between this check and
 * the item's commit, leaving content_fields pointing at a source_field that no longer exists. */
async function validateConfigContentFields(
  db: PrismaClient | Prisma.TransactionClient,
  eventId: string,
  config: EventItemConfig | undefined,
): Promise<void> {
  if (!config?.content_fields?.length) return;
  const registryFields = await loadEventCustomDataFields(db, eventId);
  const allowed = new Set(registryFields.map((f) => f.source_field));
  validateContentFieldReferences(allowed, config.content_fields);
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
      description: true,
      type: true,
      enabled: true,
      icon: true,
      config: true,
    },
  });
  if (!row || row.event_id !== eventId) return null;
  return row;
}

/** Postgres Serializable transaction conflict (concurrent badge/ops-config writes). */
export function isSerializationFailure(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2034"
  );
}

const SERIALIZATION_RETRY_ATTEMPTS = 3;

/**
 * `db.$transaction` with automatic retry on Postgres serialization failures
 * (P2034) — only meaningful (and only retried) when `isolationLevel` is
 * Serializable; a real conflict there is expected to be transient, not a
 * bug, so surfacing it as a 500 on the first hit would be wrong.
 */
export async function runSerializableTransaction<T>(
  db: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
): Promise<T> {
  const attempts =
    options?.isolationLevel === Prisma.TransactionIsolationLevel.Serializable
      ? SERIALIZATION_RETRY_ATTEMPTS
      : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await db.$transaction(fn, options);
    } catch (err) {
      if (isSerializationFailure(err) && attempt < attempts - 1) continue;
      throw err;
    }
  }
  throw new Error("unreachable: serialization retries exhausted");
}

/** Count attendee rows where the item is currently held (state = "issued"). */
async function countActivelyIssuedStates(
  db: PrismaClient | Prisma.TransactionClient,
  itemId: string,
): Promise<number> {
  return db.attendeeItemState.count({
    where: {
      event_item_id: itemId,
      state: "issued",
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

  // Self-heal legacy events missing the "badge" item (see event-items.ts) so
  // Requirements shows it immediately, not only after the event's first check-in.
  await ensureBadgeEventItem(eventId, db);

  const rows = await db.eventItem.findMany({
    where: { event_id: eventId },
    orderBy: { key: "asc" },
    select: {
      id: true,
      key: true,
      label: true,
      description: true,
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
      if (parsed.data.config?.content_fields?.length) {
        await acquireEventCustomFieldsLock(tx, eventId);
        await validateConfigContentFields(tx, eventId, parsed.data.config);
      }
      const created = await tx.eventItem.create({
        data: {
          event_id: eventId,
          key: parsed.data.key,
          label: parsed.data.label,
          description: parsed.data.description ?? null,
          type: "item",
          enabled: true,
          icon: normalizeEventItemIconForStorage(parsed.data.icon) ?? null,
          config: (parsed.data.config ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        select: {
          id: true,
          key: true,
          label: true,
          description: true,
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
    if (err instanceof UnknownContentFieldError) {
      return c.json({ error: "unknown_content_field", field: err.sourceField }, 400);
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return c.json({ error: "key_conflict" }, 409);
    }
    console.error("handleCreateEventItem failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** Row shape returned by the `eventItem` select used across the patch helpers below. */
type EventItemRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  type: string;
  enabled: boolean;
  icon: string | null;
  config: unknown;
};

type PatchEventItemOutcome =
  | { ok: true; row: EventItemRow }
  | { ok: false; reason: "unknown_content_field"; field: string }
  | { ok: false; reason: "in_use" };

/** Diffs a validated PATCH body against the existing row, returning only the fields that
 * actually changed (Prisma update payload + names for the audit log). */
function buildEventItemPatch(
  patchInput: z.infer<typeof patchEventItemSchema>,
  existing: { label: string; description: string | null; enabled: boolean; icon: string | null },
): { fields: string[]; data: Prisma.EventItemUpdateInput } {
  const fields: string[] = [];
  const data: Prisma.EventItemUpdateInput = {};

  if (patchInput.label !== undefined && patchInput.label !== existing.label) {
    data.label = patchInput.label;
    fields.push("label");
  }
  if (patchInput.description !== undefined && patchInput.description !== existing.description) {
    data.description = patchInput.description;
    fields.push("description");
  }
  if (patchInput.enabled !== undefined && patchInput.enabled !== existing.enabled) {
    data.enabled = patchInput.enabled;
    fields.push("enabled");
  }
  if (patchInput.config !== undefined) {
    data.config = patchInput.config as Prisma.InputJsonValue;
    fields.push("config");
  }
  if (patchInput.icon !== undefined && patchInput.icon !== existing.icon) {
    data.icon = patchInput.icon;
    fields.push("icon");
  }

  return { fields, data };
}

/** Decides whether this PATCH needs the "in_use" disable-check and/or a Serializable
 * transaction to keep the "badge_at_entry" ops-config toggle honest.
 *
 * "badge" backs the "Issue badge at entry" ops-config toggle — it can stop being usable
 * either by being disabled, or by "Issue on check-in" being turned off while it stays active.
 * `disabling` alone (regardless of before-state) always re-syncs too, as a backstop for events
 * whose ops_config already drifted before this check existed. */
function computePatchTransactionFlags(
  patchInput: z.infer<typeof patchEventItemSchema>,
  existing: { key: string; enabled: boolean; config: unknown },
): { disabling: boolean; needsBadgeSync: boolean; needsSerializable: boolean } {
  const disabling = patchInput.enabled === false && existing.enabled;

  const badgeUsableBefore = isBadgeItemUsable(
    existing.enabled,
    existing.config as EventItemConfig | null,
  );
  const badgeUsableAfter = isBadgeItemUsable(
    patchInput.enabled ?? existing.enabled,
    (patchInput.config ?? existing.config) as EventItemConfig | null,
  );
  const needsBadgeSync =
    existing.key === "badge" && (disabling || (badgeUsableBefore && !badgeUsableAfter));
  const needsSerializable = disabling || needsBadgeSync;

  return { disabling, needsBadgeSync, needsSerializable };
}

/** Rejects config.content_fields entries that don't exist in the event's EventCustomField
 * registry inside the caller's transaction; returns the first unknown field slug, or null when
 * all references resolve (or there are none to check). Mirrors validateConfigContentFields's
 * checks but reports back to the caller instead of throwing, since the PATCH transaction needs
 * to return a typed { ok: false } outcome rather than unwind via an exception. */
async function validatePatchContentFields(
  tx: Prisma.TransactionClient,
  eventId: string,
  config: EventItemConfig | undefined,
): Promise<string | null> {
  if (!config?.content_fields?.length) return null;
  await acquireEventCustomFieldsLock(tx, eventId);
  const registryFields = await loadEventCustomDataFields(tx, eventId);
  const allowed = new Set(registryFields.map((f) => f.source_field));
  return config.content_fields.find((f) => !allowed.has(f)) ?? null;
}

/** Turns off the event's "badge_at_entry" ops-config toggle when the badge item just became
 * unusable (disabled, or "Issue on check-in" turned off) — keeps the toggle in sync instead of
 * leaving it silently on. No-op when the toggle is already off. */
async function syncBadgeAtEntryOff(
  tx: Prisma.TransactionClient,
  c: Context,
  eventId: string,
  disabling: boolean,
): Promise<void> {
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { ops_config: true },
  });
  const currentOps = parseEventOpsConfig(event?.ops_config);
  if (!currentOps.badge_at_entry) return;

  await tx.event.update({
    where: { id: eventId },
    data: {
      ops_config: {
        ...currentOps,
        badge_at_entry: false,
      } as Prisma.InputJsonValue,
    },
  });
  await writeBulkActionLog(tx, {
    event_id: eventId,
    action_type: "ops_config_updated",
    audit: adminAuditFromContext(c),
    metadata: {
      fields: ["badge_at_entry"],
      reason: disabling ? "badge_item_disabled" : "badge_item_issue_on_checkin_disabled",
    },
  });
}

/** Body of the PATCH transaction: validates content_fields, blocks disabling an in-use item,
 * applies the update, re-syncs "badge_at_entry" when needed, and writes the audit log. */
async function applyEventItemPatch(
  tx: Prisma.TransactionClient,
  c: Context,
  eventId: string,
  itemId: string,
  config: EventItemConfig | undefined,
  data: Prisma.EventItemUpdateInput,
  fields: string[],
  disabling: boolean,
  needsBadgeSync: boolean,
): Promise<PatchEventItemOutcome> {
  const unknownField = await validatePatchContentFields(tx, eventId, config);
  if (unknownField) {
    return { ok: false, reason: "unknown_content_field", field: unknownField };
  }

  if (disabling) {
    const inUse = await countActivelyIssuedStates(tx, itemId);
    if (inUse > 0) return { ok: false, reason: "in_use" };
  }

  const row = await tx.eventItem.update({
    where: { id: itemId },
    data,
    select: {
      id: true,
      key: true,
      label: true,
      description: true,
      type: true,
      enabled: true,
      icon: true,
      config: true,
    },
  });

  if (needsBadgeSync) {
    await syncBadgeAtEntryOff(tx, c, eventId, disabling);
  }

  await writeBulkActionLog(tx, {
    event_id: eventId,
    action_type: "event_item_updated",
    audit: adminAuditFromContext(c),
    metadata: { item_key: row.key, fields },
  });

  return { ok: true, row };
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

  const { fields, data } = buildEventItemPatch(parsed.data, existing);

  if (fields.length === 0) {
    return c.json(serializeEventItem(existing));
  }

  const { disabling, needsBadgeSync, needsSerializable } = computePatchTransactionFlags(
    parsed.data,
    existing,
  );

  const result = await runSerializableTransaction(
    db,
    (tx) =>
      applyEventItemPatch(
        tx,
        c,
        eventId,
        itemId,
        parsed.data.config,
        data,
        fields,
        disabling,
        needsBadgeSync,
      ),
    needsSerializable
      ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      : undefined,
  );

  if (!result.ok) {
    if (result.reason === "unknown_content_field") {
      return c.json({ error: "unknown_content_field", field: result.field }, 400);
    }
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

  // "badge" is a structural default (see event-items.ts) — it is always
  // re-created by ensureBadgeEventItem, so deleting it would just silently
  // reappear (losing any customization) with no visible error. Disable it
  // instead; disabling auto-turns-off the "Issue badge at entry" toggle below.
  if (existing.key === "badge") {
    return c.json({ error: "default_item" }, 409);
  }

  const deleted = await db.$transaction(async (tx) => {
    const inUse = await countActivelyIssuedStates(tx, itemId);
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

  const fields: string[] = [];
  if (parsed.data.require_confirm_on_scan !== undefined) fields.push("require_confirm_on_scan");
  if (parsed.data.badge_at_entry !== undefined) fields.push("badge_at_entry");
  if (parsed.data.allow_manual_lookup !== undefined) fields.push("allow_manual_lookup");
  if (parsed.data.auto_advance_on_valid !== undefined) fields.push("auto_advance_on_valid");

  if (fields.length === 0) {
    return c.json(parseEventOpsConfig(event.ops_config));
  }

  // "badge_at_entry" is a no-op unless the "badge" item exists, is active,
  // and has "Issue on check-in" enabled — block turning it on from any of
  // those mismatched states instead of accepting a setting that silently
  // can't do anything (mirrors the frontend Switch disable). The check and
  // the write both happen inside one Serializable transaction so a
  // concurrent PATCH that disables the badge item can't race this read
  // (Prisma/Postgres detect the conflict and abort one transaction instead
  // of silently leaving badge_at_entry:true with an unusable badge item).
  const enablingBadgeAtEntry = parsed.data.badge_at_entry === true;

  const result = await runSerializableTransaction(
    db,
    async (tx) => {
      if (enablingBadgeAtEntry) {
        const badgeItem = await tx.eventItem.findFirst({
          where: { event_id: eventId, key: "badge" },
          select: { enabled: true, config: true },
        });
        if (!badgeItem || !isBadgeItemUsable(badgeItem.enabled, badgeItem.config as EventItemConfig | null)) {
          return { ok: false as const };
        }
      }

      const freshEvent = await tx.event.findUnique({
        where: { id: eventId },
        select: { ops_config: true },
      });
      const current = parseEventOpsConfig(freshEvent?.ops_config);
      const next = {
        require_confirm_on_scan:
          parsed.data.require_confirm_on_scan ?? current.require_confirm_on_scan,
        badge_at_entry: parsed.data.badge_at_entry ?? current.badge_at_entry,
        allow_manual_lookup: parsed.data.allow_manual_lookup ?? current.allow_manual_lookup,
        auto_advance_on_valid:
          parsed.data.auto_advance_on_valid ?? current.auto_advance_on_valid,
      };

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

      return { ok: true as const, next };
    },
    enablingBadgeAtEntry
      ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      : undefined,
  );

  if (!result.ok) {
    return c.json({ error: "badge_item_inactive" }, 409);
  }

  return c.json(result.next);
}
