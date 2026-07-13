import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

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
 * produce a row the app's own validation would never have allowed to be created. */
function parseLegacyContentRow(raw: unknown): LegacyContentRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.label !== "string" || typeof row.source_field !== "string") return null;
  const label = row.label.trim();
  const source_field = row.source_field.trim();
  if (!label || !source_field) return null;
  if (label.length > LABEL_MAX_LENGTH) return null;
  if (source_field.length > SOURCE_FIELD_MAX_LENGTH) return null;
  if (!SLUG_PATTERN.test(source_field)) return null;
  if (RESERVED_CUSTOM_DATA_SOURCE_FIELDS.has(source_field)) return null;

  const entry: LegacyContentRow = { label, source_field };
  if (row.type === "text" || row.type === "select" || row.type === "boolean") {
    entry.type = row.type;
  }
  if (row.required === true) entry.required = true;
  if (Array.isArray(row.options)) {
    const options = row.options.filter((o): o is string => typeof o === "string" && o.trim() !== "");
    if (options.length > 0) entry.options = options;
  }
  return entry;
}

function parseLegacyContents(config: unknown): LegacyContentRow[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const contents = (config as { contents?: unknown }).contents;
  if (!Array.isArray(contents)) return [];
  const rows: LegacyContentRow[] = [];
  for (const raw of contents) {
    const parsed = parseLegacyContentRow(raw);
    if (parsed) rows.push(parsed);
  }
  return rows;
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

  let mergedType: ContentType;
  if (leftType === rightType) mergedType = leftType;
  else if (leftType === "text") mergedType = rightType;
  else if (rightType === "text") mergedType = leftType;
  else mergedType = "select"; // select/boolean clash - same fallback the old merge used

  let lostData = leftType !== "text" && rightType !== "text" && leftType !== rightType;

  if (mergedType === "select") {
    const leftOpts = leftType === "select" ? (winner.options ?? []) : [];
    const rightOpts = rightType === "select" ? (incoming.options ?? []) : [];
    if (leftOpts.length > 0 || rightOpts.length > 0) {
      merged.type = "select";
      if (leftOpts.length === 0) {
        merged.options = rightOpts;
      } else if (rightOpts.length === 0) {
        merged.options = leftOpts;
      } else {
        const intersection = leftOpts.filter((o) => rightOpts.includes(o));
        if (intersection.length > 0) {
          merged.options = intersection;
        } else {
          merged.options = leftOpts;
          lostData = true;
        }
      }
    }
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
  const slotsByEvent = new Map<string, Map<string, LegacyContentRow | null>>();

  for (const item of allItems) {
    const rows = parseLegacyContents(item.config);
    if (rows.length === 0) continue;

    let slots = slotsByEvent.get(item.event_id);
    if (!slots) {
      const existing = await prisma.eventCustomField.findMany({
        where: { event_id: item.event_id },
        select: { source_field: true },
      });
      slots = new Map(existing.map((row) => [row.source_field, null] as const));
      slotsByEvent.set(item.event_id, slots);
    }

    const content_fields: string[] = [];
    for (const row of rows) {
      if (slots.has(row.source_field)) {
        if (!content_fields.includes(row.source_field)) content_fields.push(row.source_field);
        const winner = slots.get(row.source_field);
        if (winner) {
          const { merged, lostData } = mergeLegacyRow(winner, row);
          if (lostData) {
            conflicts.push(
              `${item.event_id}/${row.source_field}: kept "${winner.label}" (${winner.type ?? "text"}), item ${item.id} also defined it as "${row.label}" (${row.type ?? "text"}) - could not fully reconcile`,
            );
          }
          if (!metadataEqual(winner, merged)) {
            await prisma.eventCustomField.update({
              where: { event_id_source_field: { event_id: item.event_id, source_field: row.source_field } },
              data: {
                required: merged.required ?? false,
                type: merged.type ?? "text",
                options: merged.options ?? Prisma.JsonNull,
              },
            });
          }
          slots.set(row.source_field, merged);
        }
        continue;
      }

      if (slots.size >= MAX_CUSTOM_FIELDS_PER_EVENT) {
        skipped.push(
          `${item.event_id}/${row.source_field}: skipped, event already has ${MAX_CUSTOM_FIELDS_PER_EVENT} custom fields`,
        );
        continue;
      }

      slots.set(row.source_field, row);
      await prisma.eventCustomField.upsert({
        where: { event_id_source_field: { event_id: item.event_id, source_field: row.source_field } },
        create: {
          event_id: item.event_id,
          source_field: row.source_field,
          label: row.label,
          type: row.type ?? "text",
          required: row.required ?? false,
          options: row.options ?? Prisma.JsonNull,
        },
        update: {},
      });
      fieldsCreated += 1;
      if (!content_fields.includes(row.source_field)) content_fields.push(row.source_field);
    }

    const nextConfig = { ...(item.config as Record<string, unknown>) };
    delete nextConfig.contents;
    nextConfig.content_fields = content_fields;
    await prisma.eventItem.update({
      where: { id: item.id },
      data: { config: nextConfig as Prisma.InputJsonValue },
    });
    itemsUpdated += 1;
  }

  return { itemsUpdated, fieldsCreated, conflicts, skipped };
}
