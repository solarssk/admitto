import { customDataValue } from "./custom-data.js";
import type { EventItemConfig, EventItemContent } from "./types.js";

const DETAIL_SEPARATOR = " · ";

/** Legacy EventItem.config with size_field before contents generalization (ADR 0025). */
type LegacyEventItemConfig = EventItemConfig & { size_field?: string };

const SLUG_PATTERN = /^[a-z0-9_]+$/;

function parseContentRow(raw: unknown): EventItemContent | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.label !== "string" || typeof row.source_field !== "string") return null;
  const label = row.label.trim();
  const source_field = row.source_field.trim();
  if (!label || !source_field || !SLUG_PATTERN.test(source_field)) return null;

  const out: EventItemContent = { label, source_field };
  if (row.type === "text" || row.type === "select" || row.type === "boolean") {
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
  return out;
}

function formatContentValue(type: EventItemContent["type"], value: string): string {
  if (type === "boolean") {
    if (value === "true") return "Yes";
    if (value === "false") return "No";
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
    if (SLUG_PATTERN.test(source_field)) {
      return [{ label: "Shirt size", source_field }];
    }
  }
  return [];
}

/** Collect unique custom_data attribute fields across multiple EventItem configs (first label wins). */
export function collectEventCustomDataFields(itemConfigs: unknown[]): EventItemContent[] {
  const seen = new Set<string>();
  const out: EventItemContent[] = [];
  for (const config of itemConfigs) {
    for (const field of resolveEventItemContents(config)) {
      if (seen.has(field.source_field)) continue;
      seen.add(field.source_field);
      out.push(field);
    }
  }
  return out;
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
