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
 * before it reaches a webhook payload or an in-app Notification row. */
function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeNotificationText(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
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
