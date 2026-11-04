import type { Prisma, PrismaClient } from "@admitto/db";

/**
 * Sensitive attendee fields (D-E6): a question the organiser marks sensitive (health, accessibility) keeps its answers in
 * `custom_data`, but the attendee and request pages, lists, filters, search, exports, reports and the import preview leave the
 * value out. The field is there, the value is not. The wallet pass, the operator card, event items and mail are not covered
 * yet (117d), and neither is the administrator's deliberate "Show" (117b).
 *
 * This file is the one rule. Every reader of `custom_data` either calls {@link redactSensitiveCustomData}, drops the field
 * with {@link withoutSensitiveFields}, or has a recorded reason why it needs neither: `sensitive-fields-inventory.test.ts`
 * fails for a source file that reads `custom_data` and has no decision.
 */

/** What the rule needs of a field: its key and whether it is sensitive. Every field of the registry has both. */
export type SensitivityField = { source_field: string; sensitive?: boolean };

/** The keys of the sensitive fields, whichever of the event's two audiences (guest, companion) they ask. */
export function sensitiveSourceFields(fields: readonly SensitivityField[]): Set<string> {
  return new Set(fields.filter((field) => field.sensitive === true).map((field) => field.source_field));
}

/** The fields that carry no sensitive answer: the ones a column, a chart or a filter may be made of. */
export function withoutSensitiveFields<T extends SensitivityField>(fields: readonly T[]): T[] {
  return fields.filter((field) => field.sensitive !== true);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * `data` (an attendee's, a companion's or a registration's `custom_data`) without the answers to sensitive fields. The
 * keys are removed, not blanked, so the shape never says whether a sensitive question was answered. A value that is not an
 * object (null, a missing column) comes back as it is, and so does an object with nothing to remove.
 *
 * `fields` is the registry of the event (both audiences): a key is the field's `source_field`, unique within the event.
 */
export function redactSensitiveCustomData<T>(data: T, fields: readonly SensitivityField[]): T {
  if (!isPlainObject(data)) return data;
  const sensitive = sensitiveSourceFields(fields);
  if (sensitive.size === 0) return data;
  return Object.fromEntries(Object.entries(data).filter(([key]) => !sensitive.has(key))) as T;
}

/** The same for a list of records that carry `custom_data` (the companions of a registration). */
export function redactSensitiveCustomDataList<T extends { custom_data?: unknown }>(
  entries: readonly T[],
  fields: readonly SensitivityField[],
): T[] {
  return entries.map((entry) => ({ ...entry, custom_data: redactSensitiveCustomData(entry.custom_data ?? null, fields) }));
}

type SensitivityDb = PrismaClient | Prisma.TransactionClient;

/** The event's sensitive fields, of both audiences: what a reader that does not load the whole registry hands to the rule. */
export async function loadSensitiveCustomFields(db: SensitivityDb, eventId: string): Promise<SensitivityField[]> {
  const rows = await db.eventCustomField.findMany({
    where: { event_id: eventId, sensitive: true },
    select: { source_field: true },
  });
  return rows.map((row) => ({ source_field: row.source_field, sensitive: true }));
}

/**
 * A staff edit of answers (`key -> text or null`) without the entries that would only clear a sensitive answer. A sensitive
 * answer is write-only for staff: the page never shows the stored one, so an empty box means "unchanged", never "clear".
 * A non-empty value replaces the stored one.
 */
export function withoutBlankSensitiveEntries(
  fields: readonly SensitivityField[],
  patch: Record<string, string | null>,
): Record<string, string | null> {
  const sensitive = sensitiveSourceFields(fields);
  return Object.fromEntries(Object.entries(patch).filter(([key, value]) => !(sensitive.has(key) && (value === null || value === ""))));
}
