import type { EventItemContentDto } from "../api/types.js";

export type ContentRow = {
  label: string;
  source_field: string;
  type: "text" | "select" | "boolean";
  required: boolean;
  options: string;
};

export const SOURCE_FIELD_SLUG_PATTERN = /^[a-z0-9_]+$/;

export function isValidSourceFieldSlug(value: string): boolean {
  return SOURCE_FIELD_SLUG_PATTERN.test(value);
}

/** Split comma-separated option labels into a trimmed non-empty array. */
export function parseOptionsText(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export type ContentsValidationResult =
  | { ok: true; contents: EventItemContentDto[] }
  | { ok: false; message: string };

/** Validate contents hint rows; skip fully empty rows, reject partial or invalid slugs. */
export function validateContentsRows(rows: ContentRow[]): ContentsValidationResult {
  const contents: EventItemContentDto[] = [];
  const seenFields = new Set<string>();

  for (const row of rows) {
    const label = row.label.trim();
    const source_field = row.source_field.trim();

    if (!label && !source_field) continue;

    if (!label || !source_field) {
      return {
        ok: false,
        message: "Each contents row needs both a label and a source field.",
      };
    }

    if (!isValidSourceFieldSlug(source_field)) {
      return {
        ok: false,
        message:
          "Source field must use lowercase letters, numbers, and underscores only (e.g. shirt_size).",
      };
    }

    if (seenFields.has(source_field)) {
      return {
        ok: false,
        message: `Duplicate import column "${source_field}" — each row must use a unique source field.`,
      };
    }
    seenFields.add(source_field);

    const type = row.type ?? "text";
    const options = type === "select" ? parseOptionsText(row.options) : undefined;

    if (type === "select" && (!options || options.length === 0)) {
      return {
        ok: false,
        message: `Select field "${label}" needs at least one option (comma-separated).`,
      };
    }

    const entry: EventItemContentDto = { label, source_field };
    if (type !== "text") entry.type = type;
    if (row.required) entry.required = true;
    if (type === "select" && options) entry.options = options;

    contents.push(entry);
  }

  return { ok: true, contents };
}
