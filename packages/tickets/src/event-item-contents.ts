import { customDataValue } from "./custom-data.js";
import type { EventItemContent } from "./types.js";

const DETAIL_SEPARATOR = " · ";

const BOOLEAN_TRUE = new Set(["true", "yes", "1"]);
const BOOLEAN_FALSE = new Set(["false", "no", "0"]);

function formatContentValue(type: EventItemContent["type"], value: string): string {
  if (type === "boolean") {
    const lower = value.trim().toLowerCase();
    if (BOOLEAN_TRUE.has(lower)) return "Yes";
    if (BOOLEAN_FALSE.has(lower)) return "No";
  }
  return value;
}

function labelWithRequired(label: string, required?: boolean): string {
  return required ? `${label}*` : label;
}

/** Read `config.content_fields` - the list of EventCustomField source_fields an item shows as an
 * operator hint. Unknown/missing keys are resolved by the caller (buildItemDetail), not here. */
function resolveContentFieldKeys(config: unknown): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const fields = (config as { content_fields?: unknown }).content_fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter((f): f is string => typeof f === "string");
}

/** Build operator hint detail from item config + attendee custom_data. `registryFieldsByKey` is
 * the event's EventCustomField rows keyed by source_field; a content_fields entry with no match
 * (stale reference, field deleted after the item last pointed at it) is silently skipped, not an
 * error - the item drawer's own picker is what keeps this in sync during normal use. */
export function buildItemDetail(
  config: unknown,
  customData: unknown,
  registryFieldsByKey: Map<string, EventItemContent>,
): string | undefined {
  const keys = resolveContentFieldKeys(config);
  if (keys.length === 0) return undefined;

  const parts: string[] = [];
  for (const key of keys) {
    const field = registryFieldsByKey.get(key);
    if (!field) continue;
    const { label, source_field, type, required } = field;
    const value = customDataValue(customData, source_field);
    const displayLabel = labelWithRequired(label, required);
    if (value) {
      parts.push(`${displayLabel}: ${formatContentValue(type, value)}`);
    } else if (required) {
      parts.push(`${displayLabel}: -`);
    }
  }
  return parts.length > 0 ? parts.join(DETAIL_SEPARATOR) : undefined;
}
