import { filterCustomDataAttributeFields } from "@admitto/tickets/custom-data-reserved";
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

const TRUTHY_BOOLEAN_ALIASES = new Set(["true", "yes", "1"]);
const FALSY_BOOLEAN_ALIASES = new Set(["false", "no", "0"]);

/** Display value for a custom_data entry - a `boolean`-type field is stored as the raw string its
 * Select writes ("true"/"false", see CustomDataFieldInput), or possibly "yes"/"no"/"1"/"0" from a
 * CSV import that never went through that control (same aliases validateCustomFieldsForm already
 * accepts). Read-only display shows "Yes"/"No" either way, not the raw stored string. */
function formatCustomDataValue(value: string, type: CustomDataFieldDef["type"] | undefined): string {
  if (type !== "boolean") return value;
  const lower = value.trim().toLowerCase();
  if (TRUTHY_BOOLEAN_ALIASES.has(lower)) return "Yes";
  if (FALSY_BOOLEAN_ALIASES.has(lower)) return "No";
  return value;
}

/** Every custom_data entry, labeled - a configured attribute field gets its registry label,
 * anything else (a CSV import column with no matching event item, or a field removed from the
 * event's requirements after import) is humanized from its raw key. Mirrors the design mockup's
 * "Additional information" card, which shows all custom fields together rather than splitting
 * configured ones into the Profile card (#365). company/department are legacy columns the backend
 * mirrors into custom_data on every write (resolveCompanyDepartment) - excluded here since they
 * already render as their own Profile rows. */
export function allCustomDataEntries(
  customData: unknown,
  attributeFields: CustomDataFieldDef[],
  humanizeKey: (key: string) => string,
): Array<[string, string, string]> {
  if (!customData || typeof customData !== "object" || Array.isArray(customData)) return [];
  const fieldsByKey = new Map(attributeFields.map((f) => [f.source_field, f]));
  return Object.entries(customData as Record<string, unknown>)
    .filter(
      (pair): pair is [string, string] =>
        pair[0] !== "company" && pair[0] !== "department" && typeof pair[1] === "string" && pair[1].trim() !== "",
    )
    .map(([key, value]) => {
      const field = fieldsByKey.get(key);
      return [key, field?.label ?? humanizeKey(key), formatCustomDataValue(value, field?.type)];
    });
}

export { fieldLabel as customDataFieldLabel };
