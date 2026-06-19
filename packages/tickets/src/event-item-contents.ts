import { customDataValue } from "./custom-data.js";
import type { EventItemConfig, EventItemContent } from "./types.js";

const DETAIL_SEPARATOR = " · ";

/** Legacy EventItem.config with size_field before contents generalization (ADR 0025). */
type LegacyEventItemConfig = EventItemConfig & { size_field?: string };

const SLUG_PATTERN = /^[a-z0-9_]+$/;

/** Normalize config.contents, falling back to legacy size_field when present. */
export function resolveEventItemContents(config: unknown): EventItemContent[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const o = config as LegacyEventItemConfig;
  if (Array.isArray(o.contents) && o.contents.length > 0) {
    return o.contents.flatMap((c) => {
      if (!c || typeof c !== "object") return [];
      if (typeof c.label !== "string" || typeof c.source_field !== "string") return [];
      const label = c.label.trim();
      const source_field = c.source_field.trim();
      if (!label || !source_field || !SLUG_PATTERN.test(source_field)) return [];
      return [{ label, source_field }];
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
  for (const { label, source_field } of contents) {
    const value = customDataValue(customData, source_field);
    if (value) parts.push(`${label}: ${value}`);
  }
  return parts.length > 0 ? parts.join(DETAIL_SEPARATOR) : undefined;
}
