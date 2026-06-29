import { collectEventCustomDataFields } from "@admitto/tickets";
import type { EventItemDto } from "../api/types.js";

export type CustomDataFieldDef = {
  label: string;
  source_field: string;
  type?: "text" | "select" | "boolean";
  required?: boolean;
  options?: string[];
};

/** Flatten API-normalized item contents and merge duplicate source_field metadata. */
export function flattenCustomDataFieldsFromItems(items: EventItemDto[]): CustomDataFieldDef[] {
  return collectEventCustomDataFields(items.map((item) => item.config));
}

/** Read a single custom_data string field (mirrors server customDataValue semantics). */
export function readCustomDataField(raw: unknown, field: string): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>)[field];
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed || null;
}

function fieldLabel(field: CustomDataFieldDef): string {
  return field.required ? `${field.label} *` : field.label;
}

/** Initial form values for event-item attribute fields (empty until the operator chooses). */
export function initialCustomFieldValues(fields: CustomDataFieldDef[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.source_field, ""]));
}

/** Client-side validation before save/create; returns user-facing message or null. */
function isAcceptedBooleanValue(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return (
    lower === "true" ||
    lower === "false" ||
    lower === "yes" ||
    lower === "no" ||
    lower === "1" ||
    lower === "0"
  );
}

export function validateCustomFieldsForm(
  fields: CustomDataFieldDef[],
  values: Record<string, string>,
): string | null {
  for (const field of fields) {
    const raw = values[field.source_field] ?? "";
    const trimmed = raw.trim();
    const type = field.type ?? "text";

    if (field.required && !trimmed) {
      return `${field.label} is required.`;
    }
    if (!trimmed) continue;

    if (type === "select") {
      const options = field.options ?? [];
      if (!options.includes(trimmed)) {
        return `${field.label} must be one of: ${options.join(", ")}.`;
      }
    }
    if (type === "boolean" && !isAcceptedBooleanValue(trimmed)) {
      return `${field.label} must be Yes or No.`;
    }
  }
  return null;
}

export { fieldLabel as customDataFieldLabel };
