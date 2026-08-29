/** `pluralize(2, "item")` -> `"items"`, `pluralize(1, "item")` -> `"item"`. English regular
 * plural only (adds "s") - not for an irregular noun ("child", "person"). */
export function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

/** Just the suffix, for a call site that already has the noun in a template string:
 * `` `${count} item${pluralSuffix(count)}` ``. */
export function pluralSuffix(count: number): string {
  return pluralize(count, "");
}
