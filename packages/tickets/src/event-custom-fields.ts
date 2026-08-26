import type { PrismaClient, Prisma } from "@admitto/db";
import type { EventItemContent } from "./types.js";

type CustomFieldDb = PrismaClient | Prisma.TransactionClient;

/** Thrown when an EventItem's `content_fields` references a source_field that doesn't exist in
 * the event's EventCustomField registry (deleted, or never created, or belongs to another event). */
export class UnknownContentFieldError extends Error {
  constructor(public readonly sourceField: string) {
    super(`unknown_content_field:${sourceField}`);
  }
}

/** Reads an event's custom-field registry rows - the single source of truth for custom-data
 * field definitions, consumed by the check-in operator card, attendee edit/create, CSV/XLSX
 * import, and export alike. */
export async function loadEventCustomDataFields(
  db: CustomFieldDb,
  eventId: string,
): Promise<EventItemContent[]> {
  const rows = await db.eventCustomField.findMany({
    where: { event_id: eventId },
    // Rows from the same createMany share an identical created_at (single-statement `now()`),
    // so created_at alone leaves ties to whatever scan order Postgres picks - id (a per-process
    // monotonic cuid) makes ties resolve to insertion order deterministically.
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
  });
  return rows.map((row): EventItemContent => {
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

/** Reject an EventItem's `content_fields` if any entry is already referenced by a sibling item's
 * own content_fields - otherwise the same "Shirt size: L" hint would silently render on two
 * different check-in cards. `otherItems` must exclude the item being written to (a PATCH keeping
 * its own existing field selected is not a conflict with itself). */
export function assertContentFieldsNotAssignedElsewhere(
  otherItems: { key: string; label: string; config: unknown }[],
  contentFields: string[],
): void {
  if (contentFields.length === 0) return;
  const candidates = new Set(contentFields);
  for (const other of otherItems) {
    const cfg = other.config as { content_fields?: unknown } | null;
    const otherFields = Array.isArray(cfg?.content_fields) ? cfg.content_fields : [];
    for (const field of otherFields) {
      if (typeof field === "string" && candidates.has(field)) {
        throw new ContentFieldAlreadyAssignedError(field, other.key, other.label);
      }
    }
  }
}
