/** Exact-match set of labels that appear more than once - same disambiguation trigger already
 * used by CSV export/import (see attendees-export.ts, custom-data-import.ts). */
export function findDuplicateLabels(labels: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([label]) => label));
}

/** Appends `discriminator` in parentheses only when `label` collides with another row's -
 * otherwise two same-named rows (or checkboxes) would be visually indistinguishable. */
export function disambiguatedLabel(
  label: string,
  discriminator: string,
  duplicateLabels: ReadonlySet<string>,
): string {
  return duplicateLabels.has(label) ? `${label} (${discriminator})` : label;
}
