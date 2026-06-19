import type { EventItemDto } from "../api/types.js";

export type CustomDataFieldDef = {
  label: string;
  source_field: string;
};

/** Flatten API-normalized item contents and dedupe by source_field (first label wins). */
export function flattenCustomDataFieldsFromItems(items: EventItemDto[]): CustomDataFieldDef[] {
  const seen = new Set<string>();
  const out: CustomDataFieldDef[] = [];
  for (const item of items) {
    const contents = item.config?.contents;
    if (!contents?.length) continue;
    for (const c of contents) {
      if (seen.has(c.source_field)) continue;
      seen.add(c.source_field);
      out.push({ label: c.label, source_field: c.source_field });
    }
  }
  return out;
}

/** Read a single custom_data string field (mirrors server customDataValue semantics). */
export function readCustomDataField(raw: unknown, field: string): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>)[field];
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed || null;
}
