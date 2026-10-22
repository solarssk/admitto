import { EVENT_CUSTOM_FIELD_TEXT_MAX, eventCustomFieldRulesMaxLength } from "@admitto/shared";
import { customDataValue } from "./custom-data.js";
import {
  codePointLength,
  normalizeDateAnswer,
  normalizeDateTimeAnswer,
  normalizeLongTextAnswer,
  normalizePhoneAnswer,
  truncateToCodePoints,
} from "./custom-field-formats.js";
import { breaksFieldRules } from "./custom-field-rules.js";
import type { EventItemContent } from "./types.js";

const BOOLEAN_TRUE = new Set(["true", "yes", "1"]);
const BOOLEAN_FALSE = new Set(["false", "no", "0"]);

function ownCustomDataValue<T>(values: Record<string, T>, key: string): T | undefined {
  return Object.getOwnPropertyDescriptor(values, key)?.value as T | undefined;
}

function setOwnCustomDataValue<T>(values: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(values, key, { value, enumerable: true, configurable: true, writable: true });
}

function normalizeBooleanAnswer(trimmed: string): string | null {
  const lower = trimmed.toLowerCase();
  if (BOOLEAN_TRUE.has(lower)) return "true";
  return BOOLEAN_FALSE.has(lower) ? "false" : null;
}

/** `trimmed` as a field of this type stores it, or null when it is not an answer to such a field.
 * A `text` answer, and one to a type this version does not know, is cut to the short text limit:
 * the staff and import paths have always done that (the guest path refuses the same text, see
 * buildRegistrantCustomData). Every other type refuses what does not fit. */
function normalizeByType(field: EventItemContent, type: string, trimmed: string): string | null {
  switch (type) {
    case "boolean":
      return normalizeBooleanAnswer(trimmed);
    case "select":
      return (field.options ?? []).find((option) => option === trimmed) ?? null;
    case "date":
      return normalizeDateAnswer(trimmed);
    case "datetime":
      return normalizeDateTimeAnswer(trimmed);
    case "phone":
      return normalizePhoneAnswer(trimmed);
    case "long_text":
      return normalizeLongTextAnswer(trimmed);
    default:
      return truncateToCodePoints(trimmed, EVENT_CUSTOM_FIELD_TEXT_MAX);
  }
}

/** Normalize and validate one custom_data value for a configured field: the value as its type
 * stores it, then the field's format rules (`rules`, for `text`, `long_text` and `phone`). Throws
 * `invalid_custom_data_value:<source_field>` for a value that does not fit, with no value in the
 * message. */
export function normalizeCustomDataFieldValue(
  field: EventItemContent,
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const type = field.type ?? "text";
  const normalized = normalizeByType(field, type, trimmed);
  const takesRules = eventCustomFieldRulesMaxLength(type) !== null;
  if (normalized === null || (takesRules && breaksFieldRules(normalized, field.rules))) {
    throw new Error(`invalid_custom_data_value:${field.source_field}`);
  }
  return normalized;
}

function assertRequiredFieldsPresent(
  fields: EventItemContent[],
  values: Record<string, string | null | undefined>,
): void {
  for (const field of fields) {
    if (!field.required) continue;
    const value = ownCustomDataValue(values, field.source_field);
    if (!value) {
      throw new Error(`required_custom_data_field_missing:${field.source_field}`);
    }
  }
}

function assertStoredCustomDataValid(
  fields: EventItemContent[],
  values: Record<string, string | null | undefined>,
): void {
  for (const field of fields) {
    const raw = ownCustomDataValue(values, field.source_field);
    if (raw) {
      const canonical = normalizeCustomDataFieldValue(field, raw);
      // A field retyped to `phone` can still hold "+48 600-100-200". That is a number, but not in the form a phone
      // number is stored in: an edit would keep it as typed, and the list filter, which looks for digits and a +,
      // would not find it. Like an answer that no longer fits the type, it is refused until it is entered again.
      if (field.type === "phone" && canonical !== null && canonical !== raw) {
        throw new Error(`invalid_custom_data_value:${field.source_field}`);
      }
    }
  }
  assertRequiredFieldsPresent(fields, values);
}

/** An answer given through the admin API or the Add attendee form to a field that is not a long text
 * holds at most the short text limit: it is refused, never cut. (The import reads whole files, so it
 * cuts a text answer in normalizeCustomDataFieldValue instead.) */
function assertWithinAnswerLimit(field: EventItemContent, key: string, value: string): void {
  if (field.type !== "long_text" && codePointLength(value.trim()) > EVENT_CUSTOM_FIELD_TEXT_MAX) {
    throw new Error(`validation_failed:${key}`);
  }
}

/** Normalize one raw input entry and assign it into `out`, or throw for invalid input. */
function assignCustomDataEntry(
  fieldByKey: Map<string, EventItemContent>,
  out: Record<string, string>,
  key: string,
  value: unknown,
): void {
  const field = fieldByKey.get(key);
  if (!field) throw new Error(`unknown_custom_data_field:${key}`);
  if (value === null || value === undefined || value === "") return;
  if (typeof value !== "string") throw new Error(`validation_failed:${key}`);
  assertWithinAnswerLimit(field, key, value);
  const normalized = normalizeCustomDataFieldValue(field, value);
  if (normalized) setOwnCustomDataValue(out, key, normalized);
}

/** Build validated custom_data for attendee create. */
export function buildCustomDataFromInput(
  fields: EventItemContent[],
  input?: Record<string, unknown>,
): Record<string, string> | undefined {
  const fieldByKey = new Map(fields.map((field) => [field.source_field, field]));
  const out: Record<string, string> = {};

  if (input) {
    for (const [key, value] of Object.entries(input)) {
      assignCustomDataEntry(fieldByKey, out, key, value);
    }
  }

  assertRequiredFieldsPresent(fields, out);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Validate merged custom_data after a PATCH to custom_data_fields. Returns normalized patch values for persistence. */
export function validateCustomDataPatch(
  fields: EventItemContent[],
  existing: unknown,
  patch: Record<string, string | null>,
): Record<string, string | null> {
  const merged: Record<string, string | null> = {};
  const normalizedPatch: Record<string, string | null> = {};

  for (const field of fields) {
    setOwnCustomDataValue(merged, field.source_field, customDataValue(existing, field.source_field));
  }

  for (const [key, value] of Object.entries(patch)) {
    const field = fields.find((row) => row.source_field === key);
    if (!field) throw new Error(`unknown_custom_data_field:${key}`);
    if (value === null || value === "") {
      setOwnCustomDataValue(merged, key, null);
      setOwnCustomDataValue(normalizedPatch, key, null);
      continue;
    }
    assertWithinAnswerLimit(field, key, value);
    const normalized = normalizeCustomDataFieldValue(field, value);
    setOwnCustomDataValue(merged, key, normalized);
    setOwnCustomDataValue(normalizedPatch, key, normalized);
  }

  assertStoredCustomDataValid(fields, merged);
  return normalizedPatch;
}

/** Ensure stored custom_data satisfies configured field rules (any PATCH path). */
export function assertCustomDataMeetsRequirements(
  fields: EventItemContent[],
  customData: unknown,
): void {
  const values: Record<string, string | null | undefined> = {};
  for (const field of fields) {
    setOwnCustomDataValue(values, field.source_field, customDataValue(customData, field.source_field));
  }
  assertStoredCustomDataValid(fields, values);
}
