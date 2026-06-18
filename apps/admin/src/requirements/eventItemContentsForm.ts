export type ContentRow = { label: string; source_field: string };

export const SOURCE_FIELD_SLUG_PATTERN = /^[a-z0-9_]+$/;

export function isValidSourceFieldSlug(value: string): boolean {
  return SOURCE_FIELD_SLUG_PATTERN.test(value);
}

export type ContentsValidationResult =
  | { ok: true; contents: ContentRow[] }
  | { ok: false; message: string };

/** Validate contents hint rows; skip fully empty rows, reject partial or invalid slugs. */
export function validateContentsRows(rows: ContentRow[]): ContentsValidationResult {
  const contents: ContentRow[] = [];

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

    contents.push({ label, source_field });
  }

  return { ok: true, contents };
}
