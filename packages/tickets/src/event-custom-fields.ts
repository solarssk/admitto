import type { PrismaClient, Prisma } from "@admitto/db";
import type { CustomFieldAppliesTo } from "@admitto/db/status";
import { readStoredFieldRules } from "./custom-field-rules.js";
import type { RegistrantFormField } from "./registrant-input.js";
import type { EventItemContent } from "./types.js";

type CustomFieldDb = PrismaClient | Prisma.TransactionClient;

/** Thrown when an EventItem's `content_fields` references a source_field that doesn't exist in
 * the event's EventCustomField registry (deleted, or never created, or belongs to another event). */
export class UnknownContentFieldError extends Error {
  constructor(public readonly sourceField: string) {
    super(`unknown_content_field:${sourceField}`);
  }
}

/** The one order of an event's custom attendee fields, for every reader: the staff field list, the
 * Add attendee form, import and export columns, the field reports and the registration form.
 * `display_order` ascending, a field that has none after every field that has one, then oldest
 * first. Rows from the same createMany share an identical created_at (single-statement `now()`),
 * so the last key, `id` (a per-process monotonic cuid), settles those ties to insertion order
 * every time instead of leaving them to whatever scan order Postgres picks. A function, not a
 * shared array: Prisma takes the array as given, and no caller may change the rule for the rest. */
export function eventCustomFieldOrderBy(): Prisma.EventCustomFieldOrderByWithRelationInput[] {
  return [{ display_order: { sort: "asc", nulls: "last" } }, { created_at: "asc" }, { id: "asc" }];
}

type CustomFieldRow = {
  label: string;
  source_field: string;
  type: string;
  required: boolean;
  options: Prisma.JsonValue;
  rules: Prisma.JsonValue;
  show_on_form: boolean;
  description: string | null;
  applies_to: string;
};

/** The rows of an event's registry in the one order, of both audiences, or only those whose answers are about `appliesTo`. */
function readEventCustomFieldRows(
  db: CustomFieldDb,
  eventId: string,
  appliesTo?: CustomFieldAppliesTo,
): Promise<CustomFieldRow[]> {
  return db.eventCustomField.findMany({
    where: { event_id: eventId, ...(appliesTo ? { applies_to: appliesTo } : {}) },
    orderBy: eventCustomFieldOrderBy(),
  });
}

function toFieldContent(row: CustomFieldRow): EventItemContent {
  const field: EventItemContent = {
    label: row.label,
    source_field: row.source_field,
    type: row.type as EventItemContent["type"],
  };
  if (row.required) field.required = true;
  if (Array.isArray(row.options)) {
    const options = row.options.filter((o): o is string => typeof o === "string");
    if (options.length > 0) field.options = options;
  }
  const rules = readStoredFieldRules(row.rules);
  if (rules) field.rules = rules;
  return field;
}

/** Reads an event's custom-field registry rows - the single source of truth for custom-data
 * field definitions, consumed by the check-in operator card, attendee edit/create, CSV/XLSX
 * import, and export alike. In the order of {@link eventCustomFieldOrderBy}.
 *
 * `appliesTo` is whose answers the fields ask for (EventCustomField.applies_to): the default `guest` is the attendee's
 * own fields, which is every field every caller has ever read (a field about a companion is answered into
 * AttendeeCompanion.custom_data, not into Attendee.custom_data, so no reader of an attendee's answers may see it).
 * Pass `companion` to read the questions about the guest's +1. */
export async function loadEventCustomDataFields(
  db: CustomFieldDb,
  eventId: string,
  appliesTo: CustomFieldAppliesTo = "guest",
): Promise<EventItemContent[]> {
  return (await readEventCustomFieldRows(db, eventId, appliesTo)).map(toFieldContent);
}

/** The same fields in the same order, each with what the public registration form needs:
 * `show_on_form`, the organiser's `description` (left out when empty) and, for a question about the guest's
 * companion, `applies_to: "companion"` (left out for the guest's own, which is what absent means).
 * Every field is returned, of both audiences and those off the form too: `buildRegistrantCustomData` drops the keys
 * it is not to read itself, and a renderer takes the ones to draw with `pickRegistrantFormFields` (the guest's, unless
 * it is asked for the companion's), so a question about a companion is never on the guest's form. */
export async function loadRegistrantFormFields(
  db: CustomFieldDb,
  eventId: string,
): Promise<RegistrantFormField[]> {
  const rows = await readEventCustomFieldRows(db, eventId);
  return rows.map((row) => {
    const field: RegistrantFormField = { ...toFieldContent(row), show_on_form: row.show_on_form };
    if (row.applies_to === "companion") field.applies_to = "companion";
    const description = row.description?.trim();
    if (description) field.description = description;
    return field;
  });
}

/** Reject an EventItem's `content_fields` if any entry isn't in the event's registry. */
export function validateContentFieldReferences(allowed: Set<string>, contentFields: string[]): void {
  for (const field of contentFields) {
    if (!allowed.has(field)) {
      throw new UnknownContentFieldError(field);
    }
  }
}

/** Thrown when an EventItem's `content_fields` entry is already used by a different EventItem in
 * the same event - each custom field is meant to appear on exactly one item's check-in card. */
export class ContentFieldAlreadyAssignedError extends Error {
  constructor(
    public readonly sourceField: string,
    public readonly itemKey: string,
    public readonly itemLabel: string,
  ) {
    super(`content_field_already_assigned:${sourceField}`);
  }
}

export type ContentFieldConflict = { sourceField: string; itemKey: string; itemLabel: string };

/** Finds the first `contentFields` entry already referenced by a sibling item's own
 * content_fields, or null when there's no overlap - otherwise the same "Shirt size: L" hint would
 * silently render on two different check-in cards. `otherItems` must exclude the item being
 * written to (a PATCH keeping its own existing field selected is not a conflict with itself). */
export function findConflictingContentField(
  otherItems: { key: string; label: string; config: unknown }[],
  contentFields: string[],
): ContentFieldConflict | null {
  if (contentFields.length === 0) return null;
  const candidates = new Set(contentFields);
  for (const other of otherItems) {
    const cfg = other.config as { content_fields?: unknown } | null;
    const otherFields = Array.isArray(cfg?.content_fields) ? cfg.content_fields : [];
    for (const field of otherFields) {
      if (typeof field === "string" && candidates.has(field)) {
        return { sourceField: field, itemKey: other.key, itemLabel: other.label };
      }
    }
  }
  return null;
}

/** Throwing wrapper around findConflictingContentField, for callers (POST) that validate via
 * exceptions rather than a discriminated return. */
export function assertContentFieldsNotAssignedElsewhere(
  otherItems: { key: string; label: string; config: unknown }[],
  contentFields: string[],
): void {
  const conflict = findConflictingContentField(otherItems, contentFields);
  if (conflict) {
    throw new ContentFieldAlreadyAssignedError(conflict.sourceField, conflict.itemKey, conflict.itemLabel);
  }
}
