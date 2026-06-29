import { customDataValue } from "./custom-data.js";
import type { EventItemContent } from "./types.js";

const BOOLEAN_TRUE = new Set(["true", "yes", "1"]);
const BOOLEAN_FALSE = new Set(["false", "no", "0"]);

/** Normalize and validate one custom_data value for a configured field. */
export function normalizeCustomDataFieldValue(
  field: EventItemContent,
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const type = field.type ?? "text";
  if (type === "boolean") {
    const lower = trimmed.toLowerCase();
    if (BOOLEAN_TRUE.has(lower)) return "true";
    if (BOOLEAN_FALSE.has(lower)) return "false";
    throw new Error("invalid_custom_data_value");
  }
  if (type === "select") {
    const options = field.options ?? [];
    const match = options.find((option) => option === trimmed);
    if (!match) throw new Error("invalid_custom_data_value");
    return match;
  }
  return trimmed.slice(0, 100);
}

function assertRequiredFieldsPresent(
  fields: EventItemContent[],
  values: Record<string, string | null | undefined>,
): void {
  for (const field of fields) {
    if (!field.required) continue;
    const value = values[field.source_field];
    if (!value) {
      throw new Error(`required_custom_data_field_missing:${field.source_field}`);
    }
  }
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
      const field = fieldByKey.get(key);
      if (!field) throw new Error(`unknown_custom_data_field:${key}`);
      if (value === null || value === undefined || value === "") continue;
      if (typeof value !== "string") throw new Error("validation_failed");
      const normalized = normalizeCustomDataFieldValue(field, value);
      if (normalized) out[key] = normalized;
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
    merged[field.source_field] = customDataValue(existing, field.source_field);
  }

  for (const [key, value] of Object.entries(patch)) {
    const field = fields.find((row) => row.source_field === key);
    if (!field) throw new Error(`unknown_custom_data_field:${key}`);
    if (value === null || value === "") {
      merged[key] = null;
      normalizedPatch[key] = null;
      continue;
    }
    const normalized = normalizeCustomDataFieldValue(field, value);
    merged[key] = normalized;
    normalizedPatch[key] = normalized;
  }

  assertRequiredFieldsPresent(fields, merged);
  return normalizedPatch;
}
