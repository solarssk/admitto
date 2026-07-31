import { Prisma } from "./generated/prisma/client.js";
import type { PrismaClient } from "./generated/prisma/client.js";

type ContentType = "text" | "select" | "boolean";

type LegacyContentRow = {
  label: string;
  source_field: string;
  type?: ContentType;
  required?: boolean;
  options?: string[];
};

/** Mirrors packages/tickets/src/custom-data-reserved.ts's reserved slug list and
 * apps/web/src/admin/event-custom-fields-routes.ts's slug/length/cap rules - duplicated rather
 * than imported because packages/db can't depend on @admitto/tickets or apps/web without a
 * circular dependency (both of those depend on db). Keep in sync by hand if those change. */
const RESERVED_CUSTOM_DATA_SOURCE_FIELDS = new Set([
  "first_name",
  "last_name",
  "name",
  "email",
  "ticket_type",
  "external_uuid",
  "qr_payload",
  "company",
  "department",
]);
const SLUG_PATTERN = /^[a-z0-9_]+$/;
const SOURCE_FIELD_MAX_LENGTH = 60;
const LABEL_MAX_LENGTH = 60;
const MAX_CUSTOM_FIELDS_PER_EVENT = 20;

/** A legacy contents row that can never become a registry row through the live API (bad slug,
 * reserved name, or too long) is dropped rather than migrated - copying it in verbatim would
 * produce a row the app's own validation would never have allowed to be created. Returns a human
 * -readable rejection reason alongside `null` so the caller can report it instead of the row
 * silently vanishing with no trace. */
function parseLegacyContentRow(raw: unknown): { row: LegacyContentRow | null; reason: string | null } {
  if (!raw || typeof raw !== "object") return { row: null, reason: "not a valid content row" };
  const row = raw as Record<string, unknown>;
  if (typeof row.label !== "string" || typeof row.source_field !== "string") {
    return { row: null, reason: "label/source_field must be strings" };
  }
  const label = row.label.trim();
  const source_field = row.source_field.trim();
  if (!label || !source_field) return { row: null, reason: "label/source_field must not be empty" };
  if (label.length > LABEL_MAX_LENGTH) {
    return { row: null, reason: `${source_field}: label exceeds ${LABEL_MAX_LENGTH} characters` };
  }
  if (source_field.length > SOURCE_FIELD_MAX_LENGTH) {
    return { row: null, reason: `source_field exceeds ${SOURCE_FIELD_MAX_LENGTH} characters` };
  }
  if (!SLUG_PATTERN.test(source_field)) {
    return { row: null, reason: `${source_field}: not a valid slug (must match ${SLUG_PATTERN})` };
  }
  if (RESERVED_CUSTOM_DATA_SOURCE_FIELDS.has(source_field)) {
    return { row: null, reason: `${source_field}: reserved, collides with a built-in profile column` };
  }

  const entry: LegacyContentRow = { label, source_field };
  if (row.type === "text" || row.type === "select" || row.type === "boolean") {
    entry.type = row.type;
  }
  if (row.required === true) entry.required = true;
  if (Array.isArray(row.options)) {
    const options = row.options.filter((o): o is string => typeof o === "string" && o.trim() !== "");
    if (options.length > 0) entry.options = options;
  }
  return { row: entry, reason: null };
}

function parseLegacyContents(config: unknown): { rows: LegacyContentRow[]; rejected: string[] } {
  if (!config || typeof config !== "object" || Array.isArray(config)) return { rows: [], rejected: [] };
  const contents = (config as { contents?: unknown }).contents;
  if (!Array.isArray(contents)) return { rows: [], rejected: [] };
  const rows: LegacyContentRow[] = [];
  const rejected: string[] = [];
  for (const raw of contents) {
    const { row, reason } = parseLegacyContentRow(raw);
    if (row) rows.push(row);
    else if (reason) rejected.push(reason);
  }
  return { rows, rejected };
}

/** A more specific type wins over "text"; two different non-text types (select vs boolean) can't
 * be reconciled and fall back to "select", the same lossy fallback the old live merge used. */
function resolveMergedType(leftType: ContentType, rightType: ContentType): ContentType {
  if (leftType === rightType) return leftType;
  if (leftType === "text") return rightType;
  if (rightType === "text") return leftType;
  return "select";
}

/** Reconciles two select fields' options when merging a legacy row onto its registry slot's
 * winner - options intersect; an empty intersection between two non-empty option sets means the
 * two items genuinely disagree, so the winner's options are kept and the caller is told data was
 * lost (reported as a conflict) rather than silently guessing. */
function mergeSelectOptions(
  leftOpts: string[],
  rightOpts: string[],
): { options: string[] | undefined; lostData: boolean } {
  if (leftOpts.length === 0 && rightOpts.length === 0) return { options: undefined, lostData: false };
  if (leftOpts.length === 0) return { options: rightOpts, lostData: false };
  if (rightOpts.length === 0) return { options: leftOpts, lostData: false };
  const intersection = leftOpts.filter((o) => rightOpts.includes(o));
  if (intersection.length > 0) return { options: intersection, lostData: false };
  return { options: leftOpts, lostData: true };
}

/** Merge a newly-seen legacy row onto the row already occupying this event/source_field's
 * registry slot: first label wins, required is OR'd, a more specific type wins over "text", and
 * select options intersect - the same semantics mergeEventItemContentFields/mergeSelectOptions
 * enforced live before the registry existed, so a stricter definition on a later item isn't
 * silently discarded in favor of a looser one just because it was seen first. `lostData` is true
 * only when the two definitions couldn't be reconciled (empty option overlap, or a select/boolean
 * type clash) - not merely "something differed". */
function mergeLegacyRow(
  winner: LegacyContentRow,
  incoming: LegacyContentRow,
): { merged: LegacyContentRow; lostData: boolean } {
  const leftType: ContentType = winner.type ?? "text";
  const rightType: ContentType = incoming.type ?? "text";
  const merged: LegacyContentRow = { label: winner.label, source_field: winner.source_field };
  if (winner.required || incoming.required) merged.required = true;

  const mergedType = resolveMergedType(leftType, rightType);
  let lostData = leftType !== "text" && rightType !== "text" && leftType !== rightType;

  if (mergedType === "select") {
    const leftOpts = leftType === "select" ? (winner.options ?? []) : [];
    const rightOpts = rightType === "select" ? (incoming.options ?? []) : [];
    const { options, lostData: optionsLost } = mergeSelectOptions(leftOpts, rightOpts);
    if (options) {
      merged.type = "select";
      merged.options = options;
    }
    if (optionsLost) lostData = true;
  } else if (mergedType === "boolean") {
    merged.type = "boolean";
  }

  return { merged, lostData };
}

function metadataEqual(a: LegacyContentRow, b: LegacyContentRow): boolean {
  return (
    (a.required ?? false) === (b.required ?? false) &&
    (a.type ?? "text") === (b.type ?? "text") &&
    JSON.stringify(a.options ?? null) === JSON.stringify(b.options ?? null)
  );
}

/** Per-event registry slot map: source_field -> the legacy row currently occupying that slot
 * (`null` means the slot predates this run - see the caller's comment on `slotsByEvent`). Loads
 * from the DB once per event and caches the map for subsequent items in the same run. */
async function getEventSlots(
  prisma: PrismaClient,
  slotsByEvent: Map<string, Map<string, LegacyContentRow | null>>,
  eventId: string,
): Promise<Map<string, LegacyContentRow | null>> {
  const cached = slotsByEvent.get(eventId);
  if (cached) return cached;
  const existing = await prisma.eventCustomField.findMany({
    where: { event_id: eventId },
    select: { source_field: true },
  });
  const slots = new Map(existing.map((row) => [row.source_field, null] as const));
  slotsByEvent.set(eventId, slots);
  return slots;
}

/** Merges `row` onto the registry slot already won by `winner`, persisting the merged metadata
 * when it changed and updating `slots` in place. Returns the conflict message when the merge lost
 * data (see `mergeLegacyRow`), or `null` when nothing was lost. */
async function mergeRowIntoExistingSlot(
  prisma: PrismaClient,
  eventId: string,
  itemId: string,
  row: LegacyContentRow,
  winner: LegacyContentRow,
  slots: Map<string, LegacyContentRow | null>,
): Promise<string | null> {
  const { merged, lostData } = mergeLegacyRow(winner, row);
  const conflict = lostData
    ? `${eventId}/${row.source_field}: kept "${winner.label}" (${winner.type ?? "text"}), item ${itemId} also defined it as "${row.label}" (${row.type ?? "text"}) - could not fully reconcile`
    : null;
  if (!metadataEqual(winner, merged)) {
    await prisma.eventCustomField.update({
      where: { event_id_source_field: { event_id: eventId, source_field: row.source_field } },
      data: {
        required: merged.required ?? false,
        type: merged.type ?? "text",
        options: merged.options ?? Prisma.JsonNull,
      },
    });
  }
  slots.set(row.source_field, merged);
  return conflict;
}

/** Claims a fresh registry slot for `row` and persists it via upsert. Caller has already checked
 * the per-event field cap. */
async function createSlotForRow(
  prisma: PrismaClient,
  eventId: string,
  row: LegacyContentRow,
  slots: Map<string, LegacyContentRow | null>,
): Promise<void> {
  slots.set(row.source_field, row);
  await prisma.eventCustomField.upsert({
    where: { event_id_source_field: { event_id: eventId, source_field: row.source_field } },
    create: {
      event_id: eventId,
      source_field: row.source_field,
      label: row.label,
      type: row.type ?? "text",
      required: row.required ?? false,
      options: row.options ?? Prisma.JsonNull,
    },
    update: {},
  });
}

type LegacyRowOutcome = {
  contentField: string | null;
  fieldCreated: boolean;
  conflict: string | null;
  skippedReason: string | null;
};

/** Applies a single legacy row to the event's slot map: merges onto an existing slot, claims a
 * new one (unless the per-event field cap is reached), or reports why it was skipped. */
async function applyLegacyRow(
  prisma: PrismaClient,
  eventId: string,
  itemId: string,
  row: LegacyContentRow,
  slots: Map<string, LegacyContentRow | null>,
): Promise<LegacyRowOutcome> {
  if (slots.has(row.source_field)) {
    const winner = slots.get(row.source_field);
    const conflict = winner ? await mergeRowIntoExistingSlot(prisma, eventId, itemId, row, winner, slots) : null;
    return { contentField: row.source_field, fieldCreated: false, conflict, skippedReason: null };
  }

  if (slots.size >= MAX_CUSTOM_FIELDS_PER_EVENT) {
    return {
      contentField: null,
      fieldCreated: false,
      conflict: null,
      skippedReason: `${eventId}/${row.source_field}: skipped, event already has ${MAX_CUSTOM_FIELDS_PER_EVENT} custom fields`,
    };
  }

  await createSlotForRow(prisma, eventId, row, slots);
  return { contentField: row.source_field, fieldCreated: true, conflict: null, skippedReason: null };
}

/** Applies every legacy row from one item to the event's slot map, collecting the item's
 * deduplicated `content_fields` list alongside how many new registry rows were created and any
 * conflicts/skips encountered. */
async function processLegacyRows(
  prisma: PrismaClient,
  eventId: string,
  itemId: string,
  rows: LegacyContentRow[],
  slots: Map<string, LegacyContentRow | null>,
): Promise<{ contentFields: string[]; fieldsCreated: number; conflicts: string[]; skipped: string[] }> {
  const contentFields: string[] = [];
  const conflicts: string[] = [];
  const skipped: string[] = [];
  let fieldsCreated = 0;

  for (const row of rows) {
    const outcome = await applyLegacyRow(prisma, eventId, itemId, row, slots);
    if (outcome.contentField && !contentFields.includes(outcome.contentField)) {
      contentFields.push(outcome.contentField);
    }
    if (outcome.fieldCreated) fieldsCreated += 1;
    if (outcome.conflict) conflicts.push(outcome.conflict);
    if (outcome.skippedReason) skipped.push(outcome.skippedReason);
  }

  return { contentFields, fieldsCreated, conflicts, skipped };
}

/** Rewrites an item's config: drops the legacy `contents` array and writes the deduplicated
 * `content_fields` slug list that now points at the registry. */
function buildUpdatedConfig(config: unknown, contentFields: string[]): Prisma.InputJsonValue {
  const nextConfig = { ...(config as Record<string, unknown>) };
  delete nextConfig.contents;
  nextConfig.content_fields = contentFields;
  return nextConfig as Prisma.InputJsonValue;
}

/**
 * Idempotent backfill: an EventItem saved before the EventCustomField registry existed carries
 * its field definitions embedded in config.contents[]. This creates a registry row for each
 * source_field that doesn't already have one, merging stricter metadata onto it when a later item
 * redefines the same field (real, irreconcilable disagreements are reported in `conflicts`, not
 * fatal - the migration always completes), then rewrites every legacy item's config to
 * content_fields: string[] and drops contents. A row that would violate the live API's own rules
 * (invalid slug, reserved name, or the per-event field cap) is skipped and reported in `skipped`
 * rather than migrated. Runs automatically after `npm run db:migrate`; safe to re-run manually or
 * concurrently (registry writes are upserts) - a run with nothing left to migrate does nothing.
 */
export async function backfillEventCustomFields(prisma: PrismaClient): Promise<{
  itemsUpdated: number;
  fieldsCreated: number;
  conflicts: string[];
  skipped: string[];
}> {
  // No where-filter on config here: JSON-path filtering syntax is easy to get subtly wrong in a
  // way that would silently skip rows a migration needs to touch. parseLegacyContents above does
  // the real filtering in JS, which is easy to verify - this table is small enough that a full
  // scan costs nothing.
  const allItems = await prisma.eventItem.findMany({
    select: { id: true, event_id: true, config: true },
    orderBy: [{ event_id: "asc" }, { created_at: "asc" }, { id: "asc" }],
  });

  let itemsUpdated = 0;
  let fieldsCreated = 0;
  const conflicts: string[] = [];
  const skipped: string[] = [];
  // Per event: source_field -> the legacy row that currently occupies that registry slot, so a
  // later item redefining the same field can be merged onto it. `null` means the slot is taken by
  // a row that predates this run (already in the DB before it started) - its metadata is unknown,
  // so it's left untouched rather than guessed at (an admin may have hand-edited it since).
  // Known tradeoff: a row created earlier in the SAME run that gets interrupted (deploy timeout,
  // OOM kill) before this run finishes is indistinguishable on retry from a genuinely pre-existing,
  // possibly admin-edited row - a later item's stricter metadata for that field won't get merged
  // in on the retry. Not data loss (the field still exists, upsert is safe to resume), just a
  // narrower merge outcome than an uninterrupted run would have produced. Resolving this properly
  // would need a way to tell "created by an incomplete backfill" apart from "admin-edited since
  // the last backfill", which isn't knowable without a schema change - not worth it for a one-time
  // migration script on what's expected to be a small table.
  const slotsByEvent = new Map<string, Map<string, LegacyContentRow | null>>();

  for (const item of allItems) {
    const { rows, rejected } = parseLegacyContents(item.config);
    for (const reason of rejected) {
      skipped.push(`${item.event_id}/item ${item.id}: ${reason}`);
    }
    if (rows.length === 0) continue;

    const slots = await getEventSlots(prisma, slotsByEvent, item.event_id);
    const result = await processLegacyRows(prisma, item.event_id, item.id, rows, slots);
    fieldsCreated += result.fieldsCreated;
    conflicts.push(...result.conflicts);
    skipped.push(...result.skipped);

    const nextConfig = buildUpdatedConfig(item.config, result.contentFields);
    await prisma.eventItem.update({
      where: { id: item.id },
      data: { config: nextConfig },
    });
    itemsUpdated += 1;
  }

  return { itemsUpdated, fieldsCreated, conflicts, skipped };
}
