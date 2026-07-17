import { filterCustomDataAttributeFields } from "@admitto/tickets";
import { fetchEventCustomFields } from "../api/client.js";
import type { EventCustomFieldDto } from "../api/types.js";

/** The registry row shape is exactly what attendee forms need - no separate flatten/merge step. */
export type CustomDataFieldDef = EventCustomFieldDto;

/** Registry fields usable on an attendee form. Filters out any field whose source_field collides
 * with a reserved profile/import column (email, name, ...) - the live create-field API already
 * rejects these, but a field created before that rule existed, or migrated from legacy item
 * config, could still exist in the registry, and rendering it as a second editable "Email" input
 * alongside the real one would be confusing. */
export async function fetchAttendeeCustomFields(eventId: string, signal?: AbortSignal): Promise<CustomDataFieldDef[]> {
  const fields = await fetchEventCustomFields(eventId, signal);
  return filterCustomDataAttributeFields(fields);
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

/** custom_data keys not covered by any configured attribute field - e.g. a CSV import column
 * with no matching event item, or a field removed from the event's requirements after import
 * (#365). company/department are legacy columns the backend mirrors into custom_data on every
 * write (resolveCompanyDepartment) - excluded here since they already render as their own
 * Profile rows. */
export function leftoverCustomDataEntries(
  customData: unknown,
  attributeFields: CustomDataFieldDef[],
): Array<[string, string]> {
  if (!customData || typeof customData !== "object" || Array.isArray(customData)) return [];
  const known = new Set(attributeFields.map((f) => f.source_field));
  known.add("company");
  known.add("department");
  return Object.entries(customData as Record<string, unknown>).filter(
    (pair): pair is [string, string] =>
      !known.has(pair[0]) && typeof pair[1] === "string" && pair[1].trim() !== "",
  );
}

export { fieldLabel as customDataFieldLabel };
