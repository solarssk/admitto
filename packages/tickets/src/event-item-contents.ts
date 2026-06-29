import { customDataValue } from "./custom-data.js";
import type { EventItemConfig, EventItemContent } from "./types.js";

const DETAIL_SEPARATOR = " · ";

/** Legacy EventItem.config with size_field before contents generalization (ADR 0025). */
type LegacyEventItemConfig = EventItemConfig & { size_field?: string };

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

/** Normalize config.contents, falling back to legacy size_field when present. */
export function resolveEventItemContents(config: unknown): EventItemContent[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const o = config as LegacyEventItemConfig;
  if (Array.isArray(o.contents) && o.contents.length > 0) {
    return o.contents.flatMap((row) => {
      const parsed = parseContentRow(row);
      return parsed ? [parsed] : [];
    });
  }
  if (typeof o.size_field === "string" && o.size_field.trim()) {
    const source_field = o.size_field.trim();
    if (
      source_field.length <= SOURCE_FIELD_MAX_LENGTH &&
      SLUG_PATTERN.test(source_field)
    ) {
      return [{ label: "Shirt size", source_field }];
    }
  }
  return [];
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

/** Build operator hint detail from item config + attendee custom_data. */
export function buildItemDetail(config: unknown, customData: unknown): string | undefined {
  const contents = resolveEventItemContents(config);
  if (contents.length === 0) return undefined;

  const parts: string[] = [];
  for (const { label, source_field, type, required } of contents) {
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
