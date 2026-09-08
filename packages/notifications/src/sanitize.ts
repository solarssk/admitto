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
 * before it reaches a webhook payload or an in-app Notification row.
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
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return sanitizeNotificationText(value.message);
  if (value instanceof Map) {
    return Object.fromEntries([...value].map(([key, v]) => [String(key), sanitizeJsonValue(v)]));
  }
  if (value instanceof Set) return [...value].map(sanitizeJsonValue);
  if (value instanceof RegExp) return sanitizeNotificationText(value.source);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [key, sanitizeJsonValue(v)]),
    );
  }
  return value;
}

export function sanitizeNotificationMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return metadata;
  return sanitizeJsonValue(metadata) as Record<string, unknown>;
}
