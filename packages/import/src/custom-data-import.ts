import { EVENT_CUSTOM_FIELD_LONG_TEXT_MAX, type EventCustomFieldRules } from "@admitto/shared";
import {
  filterCustomDataAttributeFields,
  isReservedCustomDataSourceField,
  normalizeCustomDataFieldValue,
  type EventItemContent,
} from "@admitto/tickets";
import type { ImportAttributeField } from "./types.js";

function normalizedLabelKey(label: string): string {
  return label.trim().toLowerCase();
}

function ownStringValue(record: Record<string, string>, key: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, key) as TypedPropertyDescriptor<string>;
  return descriptor?.value;
}

function setOwnStringValue(record: Record<string, string>, key: string, value: string): void {
  Object.defineProperty(record, key, { value, enumerable: true, configurable: true, writable: true });
}

function exportStyleLabel(field: ImportAttributeField, duplicateLabels: Set<string>): string {
  return duplicateLabels.has(normalizedLabelKey(field.label))
    ? `${field.label} (${field.source_field})`
    : field.label;
}

/** Map normalized CSV header → attribute field (slug or export-style label). */
export function buildAttributeHeaderKeys(
  fields: ImportAttributeField[],
): { allowedHeaders: Set<string>; duplicateLabels: Set<string> } {
  const labelCounts = new Map<string, number>();
  for (const field of fields) {
    const key = normalizedLabelKey(field.label);
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }
  const duplicateLabels = new Set(
    [...labelCounts.entries()].filter(([, count]) => count > 1).map(([label]) => label),
  );

  const allowedHeaders = new Set<string>();
  for (const field of fields) {
    allowedHeaders.add(field.source_field);
    allowedHeaders.add(exportStyleLabel(field, duplicateLabels).trim().toLowerCase());
  }
  return { allowedHeaders, duplicateLabels };
}

function readAttributeCell(
  raw: Record<string, string>,
  field: ImportAttributeField,
  duplicateLabels: Set<string>,
): string {
  const direct = ownStringValue(raw, field.source_field);
  if (direct !== undefined) return direct.trim();
  const labelKey = exportStyleLabel(field, duplicateLabels).trim().toLowerCase();
  if (isReservedCustomDataSourceField(labelKey)) return "";
  return (ownStringValue(raw, labelKey) ?? "").trim();
}

// A date or date and time cell of an XLSX file reaches the importer as the instant the reader made of
// it, "2026-11-04T10:30:00.000Z": the numbers are the cell's own wall-clock time (a spreadsheet keeps
// no zone), and the Z is only how the reader writes them. Any other instant is left alone and refused.
const SPREADSHEET_DATE = /^(\d{4}-\d{2}-\d{2})T00:00:00\.000Z$/;
const SPREADSHEET_DATE_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):00\.000Z$/;

/** One cell as its field's type reads it: a date cell of an XLSX file is the date it shows. */
function importCellValue(field: { type?: string }, value: string): string {
  if (field.type === "date") return SPREADSHEET_DATE.exec(value)?.[1] ?? value;
  if (field.type === "datetime") return SPREADSHEET_DATE_TIME.exec(value)?.[1] ?? value;
  return value;
}

/** Validate and normalize only attribute cells present in the CSV row (no required-field check). */
function buildPartialCustomDataFromInput(
  fields: EventItemContent[],
  input: Record<string, string>,
): Record<string, string> | undefined {
  const fieldByKey = new Map(fields.map((field) => [field.source_field, field]));
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(input)) {
    const field = fieldByKey.get(key);
    if (!field) throw new Error(`unknown_custom_data_field:${key}`);
    const normalized = normalizeCustomDataFieldValue(field, importCellValue(field, value));
    if (normalized) setOwnStringValue(out, key, normalized);
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export function importCustomDataSkipReason(
  err: unknown,
  fields: ImportAttributeField[],
): string {
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("required_custom_data_field_missing:")) {
    const slug = message.slice("required_custom_data_field_missing:".length);
    const field = fields.find((row) => row.source_field === slug);
    return `Missing required attribute: ${field?.label ?? slug}`;
  }
  return "Invalid custom attribute data";
}

/** The length a field asks for, in words, or null when it asks for none. */
function lengthExpectation(min: number | undefined, max: number | undefined): string | null {
  if (min !== undefined && min === max) return `exactly ${min} characters`;
  if (min !== undefined && max !== undefined) return `${min} to ${max} characters`;
  if (min !== undefined) return `at least ${min} characters`;
  return max === undefined ? null : `at most ${max} characters`;
}

/** What a `text`, `long_text` or `phone` field asks for, in words: its type, then its rules. */
function textExpectations(field: ImportAttributeField): string[] {
  const rules: EventCustomFieldRules = field.rules ?? {};
  const parts: string[] = [];
  if (field.type === "phone") parts.push("a phone number with 3 to 15 digits");
  if (rules.digits_only) parts.push("digits only");
  const maxLength = rules.max_length ?? (field.type === "long_text" ? EVENT_CUSTOM_FIELD_LONG_TEXT_MAX : undefined);
  const length = lengthExpectation(rules.min_length, maxLength);
  if (length) parts.push(length);
  if (rules.example) parts.push(`for example ${rules.example}`);
  return parts;
}

/** Human-readable hint appended to the "invalid value" reason, based on the field's type and rules. */
function invalidValueHint(field: ImportAttributeField): string {
  if (field.type === "select" && field.options?.length) {
    return ` (expected one of: ${field.options.join(", ")})`;
  }
  if (field.type === "boolean") {
    return " (expected Yes/No or true/false)";
  }
  if (field.type === "date") return " (expected a date as YYYY-MM-DD)";
  if (field.type === "datetime") return " (expected a date and time as YYYY-MM-DDTHH:mm)";
  const expected = textExpectations(field);
  return expected.length > 0 ? ` (expected ${expected.join(", ")})` : "";
}

/** Find the first attribute field whose CSV cell fails normalization (used to build the
 * user-facing reason once we already know some field in the row is invalid). */
function findInvalidCustomDataField(
  raw: Record<string, string>,
  fields: ImportAttributeField[],
  duplicateLabels: Set<string>,
): ImportAttributeField | undefined {
  for (const field of fields) {
    const value = readAttributeCell(raw, field, duplicateLabels);
    if (!value) continue;
    try {
      normalizeCustomDataFieldValue(field, importCellValue(field, value));
    } catch {
      return field;
    }
  }
  return undefined;
}

/** Translate a thrown error from {@link buildPartialCustomDataFromInput} into a user-facing
 * failure reason, preserving the original error-message-based branching. */
function customDataExtractionFailure(
  err: unknown,
  raw: Record<string, string>,
  fields: ImportAttributeField[],
  duplicateLabels: Set<string>,
): { ok: false; reason: string } {
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("unknown_custom_data_field:")) {
    return { ok: false, reason: "Invalid custom attribute data" };
  }
  if (message.startsWith("invalid_custom_data_value:")) {
    const invalidField = findInvalidCustomDataField(raw, fields, duplicateLabels);
    if (invalidField) {
      return {
        ok: false,
        reason: `Invalid value for ${invalidField.label}${invalidValueHint(invalidField)}`,
      };
    }
  }
  return { ok: false, reason: "Invalid custom attribute data" };
}

export function extractCustomDataFromRow(
  raw: Record<string, string>,
  attributeFields: ImportAttributeField[],
  duplicateLabels: Set<string>,
): { ok: true; custom_data?: Record<string, string> } | { ok: false; reason: string } {
  const fields = filterCustomDataAttributeFields(attributeFields);
  if (fields.length === 0) return { ok: true };

  const input: Record<string, string> = {};
  for (const field of fields) {
    const value = readAttributeCell(raw, field, duplicateLabels);
    if (value) setOwnStringValue(input, field.source_field, value);
  }

  try {
    const custom_data = buildPartialCustomDataFromInput(
      fields,
      input,
    );
    return { ok: true, custom_data };
  } catch (err) {
    return customDataExtractionFailure(err, raw, fields, duplicateLabels);
  }
}
