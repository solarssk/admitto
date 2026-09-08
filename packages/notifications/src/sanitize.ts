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

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Recursively sanitizes every string in a JSON-shaped value, at any depth - metadata is typed as
 * Record<string, unknown> precisely because call sites attach arbitrary structured context, and a
 * sensitive string nested inside an object or array must be redacted exactly like a top-level one
 * before it reaches a webhook payload or an in-app Notification row.
 *
 * A Date/Error (or any other non-plain object - RegExp, Map, a class instance) is deliberately
 * NOT treated as a plain dictionary: Object.entries(new Date()) and Object.entries(new Error())
 * both return [] (their real state lives in non-enumerable internal slots), so recursing into
 * them the same way as a plain object would silently rewrite a real value into an empty {} with
 * no error or signal - and every channel's metadata rendering does `String(value)` per entry, so
 * that {} becomes the literal text "[object Object]" in a delivered security alert. Date/Error get
 * a useful, specific representation; anything else exotic falls back to a sanitized String(value)
 * rather than losing the value entirely. */
function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeNotificationText(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return sanitizeNotificationText(value.message);
  if (value !== null && typeof value === "object") {
    if (isPlainObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [key, sanitizeJsonValue(v)]),
      );
    }
    return sanitizeNotificationText(String(value));
  }
  return value;
}

export function sanitizeNotificationMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return metadata;
  return sanitizeJsonValue(metadata) as Record<string, unknown>;
}
