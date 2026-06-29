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
  const direct = raw[field.source_field];
  if (direct !== undefined) return direct.trim();
  const labelKey = exportStyleLabel(field, duplicateLabels).trim().toLowerCase();
  if (isReservedCustomDataSourceField(labelKey)) return "";
  return (raw[labelKey] ?? "").trim();
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
    const normalized = normalizeCustomDataFieldValue(field, value);
    if (normalized) out[key] = normalized;
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
  if (message === "invalid_custom_data_value") {
    return "Invalid custom attribute data";
  }
  return "Invalid custom attribute data";
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
    if (value) input[field.source_field] = value;
  }

  try {
    const custom_data = buildPartialCustomDataFromInput(
      fields as EventItemContent[],
      input,
    );
    return { ok: true, custom_data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("unknown_custom_data_field:")) {
      return { ok: false, reason: "Invalid custom attribute data" };
    }
    if (message === "invalid_custom_data_value") {
      for (const field of fields) {
        const value = readAttributeCell(raw, field, duplicateLabels);
        if (!value) continue;
        try {
          normalizeCustomDataFieldValue(field as EventItemContent, value);
        } catch {
          const hint =
            field.type === "select" && field.options?.length
              ? ` (expected one of: ${field.options.join(", ")})`
              : field.type === "boolean"
                ? " (expected Yes/No or true/false)"
                : "";
          return { ok: false, reason: `Invalid value for ${field.label}${hint}` };
        }
      }
    }
    return { ok: false, reason: "Invalid custom attribute data" };
  }
}
