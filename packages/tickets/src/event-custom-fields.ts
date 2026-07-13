import type { PrismaClient, Prisma } from "@prisma/client";
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
    orderBy: { created_at: "asc" },
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
