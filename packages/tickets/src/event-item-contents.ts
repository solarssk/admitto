import { customDataValue } from "./custom-data.js";
import type { EventItemContent } from "./types.js";

const DETAIL_SEPARATOR = " · ";

const SLUG_PATTERN = /^[a-z0-9_]+$/;
const SOURCE_FIELD_MAX_LENGTH = 60;

const BOOLEAN_TRUE = new Set(["true", "yes", "1"]);
const BOOLEAN_FALSE = new Set(["false", "no", "0"]);

function parseContentRow(raw: unknown): EventItemContent | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.label !== "string" || typeof row.source_field !== "string") return null;
  const label = row.label.trim();
  const source_field = row.source_field.trim();
  if (
    !label ||
    !source_field ||
    source_field.length > SOURCE_FIELD_MAX_LENGTH ||
    !SLUG_PATTERN.test(source_field)
  ) {
    return null;
  }

  const out: EventItemContent = { label, source_field };
  if (row.type === "text" || row.type === "boolean") {
    out.type = row.type;
  }
  if (row.required === true) out.required = true;
  if (Array.isArray(row.options)) {
    const options = row.options
      .filter((option): option is string => typeof option === "string")
      .map((option) => option.trim())
      .filter(Boolean);
    if (options.length > 0) out.options = options;
  }
  if (row.type === "select") {
    if (!out.options?.length) return null;
    out.type = "select";
  }
  return out;
}

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

/** Normalize the legacy embedded-definition `config.contents` shape. `EventItemConfig` no longer
 * declares `contents` (new items use `content_fields`, see buildItemDetail below), so this reads
 * it via a weak cast - still needed by collectEventCustomDataFields()'s callers until they're
 * rewired onto the EventCustomField registry, and as buildItemDetail's own fallback for an item
 * that hasn't been re-saved since the registry migration. */
export function resolveEventItemContents(config: unknown): EventItemContent[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const contents = (config as { contents?: unknown }).contents;
  if (!Array.isArray(contents) || contents.length === 0) return [];
  return contents.flatMap((row) => {
    const parsed = parseContentRow(row);
    return parsed ? [parsed] : [];
  });
}

/** Read `config.content_fields` - the list of EventCustomField source_fields an item shows as an
 * operator hint. Unknown/missing keys are resolved by the caller (buildItemDetail), not here. */
function resolveContentFieldKeys(config: unknown): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const fields = (config as { content_fields?: unknown }).content_fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter((f): f is string => typeof f === "string");
}

/** True once an item has been saved via the current UI (even with every hint unchecked) - lets
 * buildItemDetail tell "operator explicitly cleared every hint" apart from "never touched since
 * the registry migration", which need different fallback behavior. */
function hasContentFieldsKey(config: unknown): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  return "content_fields" in config;
}

/** Collect unique custom_data attribute fields across multiple EventItem configs (merged metadata). */
function effectiveContentType(field: EventItemContent): "text" | "select" | "boolean" {
  return field.type ?? "text";
}

function mergeSelectOptions(left: string[], right: string[], sourceField: string): string[] {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const intersection = left.filter((option) => right.includes(option));
  if (intersection.length === 0) {
    throw new Error(`conflicting_custom_data_field_options:${sourceField}`);
  }
  return intersection;
}

/** Merge duplicate source_field rows across items (first label wins; stricter metadata wins). */
export function mergeEventItemContentFields(
  existing: EventItemContent,
  incoming: EventItemContent,
): EventItemContent {
  const leftType = effectiveContentType(existing);
  const rightType = effectiveContentType(incoming);

  const merged: EventItemContent = {
    label: existing.label,
    source_field: existing.source_field,
  };

  if (existing.required === true || incoming.required === true) {
    merged.required = true;
  }

  let mergedType: "text" | "select" | "boolean";
  if (leftType === rightType) {
    mergedType = leftType;
  } else if (leftType === "text") {
    mergedType = rightType;
  } else if (rightType === "text") {
    mergedType = leftType;
  } else {
    mergedType = "select";
  }

  if (mergedType === "select") {
    const leftOpts = leftType === "select" ? (existing.options ?? []) : [];
    const rightOpts = rightType === "select" ? (incoming.options ?? []) : [];
    const options = mergeSelectOptions(leftOpts, rightOpts, existing.source_field);
    if (options.length === 0) {
      mergedType = "text";
    } else {
      merged.type = "select";
      merged.options = options;
    }
  } else if (mergedType === "boolean") {
    merged.type = "boolean";
  }

  return merged;
}

export function collectEventCustomDataFields(itemConfigs: unknown[]): EventItemContent[] {
  const byField = new Map<string, EventItemContent>();
  for (const config of itemConfigs) {
    for (const field of resolveEventItemContents(config)) {
      const existing = byField.get(field.source_field);
      byField.set(
        field.source_field,
        existing ? mergeEventItemContentFields(existing, field) : field,
      );
    }
  }
  return [...byField.values()];
}

/** Build operator hint detail from item config + attendee custom_data. `registryFieldsByKey` is
 * the event's EventCustomField rows keyed by source_field; a content_fields entry with no match
 * (stale reference, field deleted after the item last pointed at it) is silently skipped, not an
 * error - the item drawer's own picker is what keeps this in sync during normal use.
 *
 * An item that predates the registry migration and hasn't been re-saved since has no
 * content_fields key at all - falls back to the legacy embedded config.contents shape so its
 * check-in hint doesn't silently disappear on upgrade. An item saved via the current UI with
 * content_fields explicitly [] (every hint unchecked) is left alone - that's the operator's
 * deliberate choice, not a gap to paper over. */
export function buildItemDetail(
  config: unknown,
  customData: unknown,
  registryFieldsByKey: Map<string, EventItemContent>,
): string | undefined {
  const keys = resolveContentFieldKeys(config);
  const fields: EventItemContent[] =
    keys.length > 0
      ? keys.flatMap((key) => {
          const field = registryFieldsByKey.get(key);
          return field ? [field] : [];
        })
      : hasContentFieldsKey(config)
        ? []
        : resolveEventItemContents(config);
  if (fields.length === 0) return undefined;

  const parts: string[] = [];
  for (const field of fields) {
    const { label, source_field, type, required } = field;
    const value = customDataValue(customData, source_field);
    const displayLabel = labelWithRequired(label, required);
    if (value) {
      parts.push(`${displayLabel}: ${formatContentValue(type, value)}`);
    } else if (required) {
      parts.push(`${displayLabel}: —`);
    }
  }
  return parts.length > 0 ? parts.join(DETAIL_SEPARATOR) : undefined;
}
