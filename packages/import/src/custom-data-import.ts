import {
  buildCustomDataFromInput,
  filterCustomDataAttributeFields,
  normalizeCustomDataFieldValue,
  type EventItemContent,
} from "@admitto/tickets";
import type { ImportAttributeField } from "./types.js";

function exportStyleLabel(field: ImportAttributeField, duplicateLabels: Set<string>): string {
  return duplicateLabels.has(field.label)
    ? `${field.label} (${field.source_field})`
    : field.label;
}

/** Map normalized CSV header → attribute field (slug or export-style label). */
export function buildAttributeHeaderKeys(
  fields: ImportAttributeField[],
): { allowedHeaders: Set<string>; duplicateLabels: Set<string> } {
  const labelCounts = new Map<string, number>();
  for (const field of fields) {
    labelCounts.set(field.label, (labelCounts.get(field.label) ?? 0) + 1);
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
  return (raw[labelKey] ?? "").trim();
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
    const custom_data = buildCustomDataFromInput(
      fields as EventItemContent[],
      input,
    );
    return { ok: true, custom_data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("required_custom_data_field_missing:")) {
      const slug = message.slice("required_custom_data_field_missing:".length);
      const field = fields.find((row) => row.source_field === slug);
      return {
        ok: false,
        reason: `Missing required attribute: ${field?.label ?? slug}`,
      };
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
