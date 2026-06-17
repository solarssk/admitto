import { customDataValue } from "./custom-data.js";
import type { EventItemConfig, EventItemContent } from "./types.js";

const DETAIL_SEPARATOR = " · ";

/** Legacy EventItem.config with size_field before contents generalization (ADR 0025). */
type LegacyEventItemConfig = EventItemConfig & { size_field?: string };

/** Normalize config.contents, falling back to legacy size_field when present. */
export function resolveEventItemContents(config: unknown): EventItemContent[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const o = config as LegacyEventItemConfig;
  if (Array.isArray(o.contents) && o.contents.length > 0) {
    return o.contents.filter(
      (c): c is EventItemContent =>
        Boolean(c) &&
        typeof c === "object" &&
        typeof c.label === "string" &&
        typeof c.source_field === "string",
    );
  }
  if (typeof o.size_field === "string" && o.size_field.trim()) {
    return [{ label: "Shirt size", source_field: o.size_field.trim() }];
  }
  return [];
}

/** Build operator hint detail from item config + attendee custom_data. */
export function buildItemDetail(config: unknown, customData: unknown): string | undefined {
  const contents = resolveEventItemContents(config);
  if (contents.length === 0) return undefined;

  const parts: string[] = [];
  for (const { label, source_field } of contents) {
    const value = customDataValue(customData, source_field);
    if (value) parts.push(`${label}: ${value}`);
  }
  return parts.length > 0 ? parts.join(DETAIL_SEPARATOR) : undefined;
}
