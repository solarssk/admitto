import { sanitizeDeliveryError } from "@admitto/mail-delivery";

/**
 * Redacts email/token/URL-shaped fragments from notification text before any channel sees it -
 * the same technique packages/mail-delivery/src/sanitizeError.ts already applies to provider
 * error strings (ADR 0038 §6: "the third place this exact rule applies", alongside sanitizeError
 * and ADR 0037's diagnostics whitelist). Defense-in-depth: registry call sites are developer-
 * authored, not attacker input, but a stray secret or attendee PII interpolated into a title/body
 * must never reach an email/webhook/in-app row.
 */
export function sanitizeNotificationText(value: string): string {
  return sanitizeDeliveryError(value) ?? "";
}

/** Recursively sanitizes every string in a JSON-shaped value, at any depth - metadata is typed as
 * Record<string, unknown> precisely because call sites attach arbitrary structured context, and a
 * sensitive string nested inside an object or array must be redacted exactly like a top-level one
 * before it reaches a webhook payload or an in-app Notification row. Object/Map KEYS are
 * sanitized too, not just values - a caller building a per-subject map (e.g. a failed-login count
 * keyed by the attempted email) would otherwise leak that key verbatim into every channel's
 * output even though the exact same string as a VALUE would have been redacted.
 *
 * bigint (e.g. a raw SQL aggregate count) converts to its decimal string, undefined to JSON null,
 * a function/symbol to a fixed marker/its sanitized description: none of these are valid JSON, so
 * neither JSON.stringify (WebhookChannel's payload) nor Prisma's JSON serialization (InAppChannel's
 * metadata column) accepts them - both throw - so passing one through unconverted would silently
 * fail delivery on 2 of the 3 channels instead of just rendering as text, the same "safe channels
 * never see a value that breaks them" reasoning as every other conversion here.
 *
 * Date/Error/Map/Set/RegExp each get their own explicit, lossless-ish conversion instead of
 * falling into the generic object branch: Object.entries(new Date()) and Object.entries(new
 * Error()) both return [] (their real state lives in non-enumerable internal slots) - same for
 * Map/Set, whose entries live in an internal slot rather than own enumerable properties - so
 * recursing into any of them the same way as a plain object would silently rewrite a real value
 * into an empty {} with no error or signal, and every channel's metadata rendering does
 * `String(value)` per entry, turning that {} into the literal text "[object Object]" in a
 * delivered security alert. An ordinary class instance (not one of the five above) still goes
 * through Object.entries like a plain object: unlike Date/Error/Map/Set, its real data - for any
 * normal class using public fields - genuinely does live in its own enumerable properties, so
 * treating it as a dictionary is correct, not lossy. */
function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeNotificationText(value);
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return null;
  if (typeof value === "function") return "[Function]";
  if (typeof value === "symbol") return sanitizeNotificationText(value.toString());
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return sanitizeNotificationText(value.message);
  if (value instanceof Map) return Object.fromEntries(sanitizeEntries([...value]));
  if (value instanceof Set) return [...value].map(sanitizeJsonValue);
  if (value instanceof RegExp) return sanitizeNotificationText(value.source);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(sanitizeEntries(Object.entries(value as Record<string, unknown>)));
  }
  return value;
}

/** Sanitizes a set of [key, value] entries, disambiguating keys that collide after sanitization
 * (e.g. two different attacker-controlled email keys both redacting to the literal "[redacted]")
 * with a numeric suffix - Object.fromEntries silently keeps only the LAST entry for a repeated
 * key, so without this a second colliding entry would silently overwrite, not just rename, the
 * first one's value. */
function sanitizeEntries(entries: Array<[unknown, unknown]>): Array<[string, unknown]> {
  const seen = new Map<string, number>();
  return entries.map(([key, v]) => {
    const base = sanitizeNotificationText(String(key));
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return [occurrence === 1 ? base : `${base}_${occurrence}`, sanitizeJsonValue(v)];
  });
}

export function sanitizeNotificationMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return metadata;
  return sanitizeJsonValue(metadata) as Record<string, unknown>;
}
