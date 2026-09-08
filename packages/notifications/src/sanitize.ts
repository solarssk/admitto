import { sanitizeDeliveryError } from "@admitto/mail-delivery";

/**
 * Redacts email/token/URL-shaped fragments from notification text before any channel sees it —
 * the same technique packages/mail-delivery/src/sanitizeError.ts already applies to provider
 * error strings (ADR 0038 §6: "the third place this exact rule applies", alongside sanitizeError
 * and ADR 0037's diagnostics whitelist). Defense-in-depth: registry call sites are developer-
 * authored, not attacker input, but a stray secret or attendee PII interpolated into a title/body
 * must never reach an email/webhook/in-app row.
 */
export function sanitizeNotificationText(value: string): string {
  return sanitizeDeliveryError(value) ?? "";
}

export function sanitizeNotificationMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return metadata;
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      typeof value === "string" ? sanitizeNotificationText(value) : value,
    ]),
  );
}
