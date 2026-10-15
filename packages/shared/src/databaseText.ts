/**
 * Postgres cannot store U+0000 in a text value, and a JSON value cannot hold U+0000 or a lone UTF-16
 * surrogate either: a query or a write that carries one fails as a whole. Both are replaced with
 * U+FFFD instead of dropped, so what is stored still shows that something was there
 * ("x\u0000@example.com" does not turn into the plain address "x@example.com").
 */

/** A valid surrogate pair (captured, kept) or any single surrogate left over (replaced). */
const SURROGATE_PAIR_OR_LONE = /([\ud800-\udbff][\udc00-\udfff])|[\ud800-\udfff]/g;

/** The text with U+0000 and every lone surrogate replaced by U+FFFD. */
export function toDatabaseText(value: string): string {
  return value
    .replaceAll("\u0000", "\ufffd")
    .replace(SURROGATE_PAIR_OR_LONE, (match, pair: string | undefined) => pair ?? "\ufffd");
}

function cleanJsonValue(value: unknown): unknown {
  if (typeof value === "string") return toDatabaseText(value);
  if (Array.isArray(value)) return value.map(cleanJsonValue);
  if (typeof value === "object" && value !== null) {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [toDatabaseText(key), cleanJsonValue(entry)]),
    );
  }
  return value;
}

/** A copy of a JSON-like value with `toDatabaseText` applied to every string, keys included. */
export function toDatabaseJson<T>(value: T): T {
  return cleanJsonValue(value) as T;
}
