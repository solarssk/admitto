/** Lowercase slug for event item keys (`gift_bag`, `headset`). Spaces → underscores. */
export function slugifyItemKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "") // NOSONAR — single anchored quantifier, no alternation/nesting; cannot backtrack combinatorially regardless of input length
    .replace(/_+/g, "_")
    .slice(0, 60);
}

/** Pick a unique key among existing item keys (appends `_2`, `_3`, …). */
export function uniqueItemKey(label: string, existingKeys: string[]): string {
  const base = slugifyItemKey(label);
  if (!base) return "";
  if (!existingKeys.includes(base)) return base;
  for (let n = 2; n < 100; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, Math.max(1, 60 - suffix.length))}${suffix}`;
    if (!existingKeys.includes(candidate)) return candidate;
  }
  return "";
}
