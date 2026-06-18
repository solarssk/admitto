/** Strip token-like and email-like fragments from provider errors before persisting. */
export function sanitizeDeliveryError(message: string | undefined): string | undefined {
  if (!message) return undefined;
  let s = message;
  // base64url ticket tokens (~43 chars)
  s = s.replace(/[A-Za-z0-9_-]{40,60}/g, "[redacted]");
  // emails
  s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[redacted]");
  return s.slice(0, 2000);
}

/** Admin API-safe send error text — no provider internals or long opaque messages. */
export function clientSafeDeliveryError(message: string | undefined): string {
  const sanitized = sanitizeDeliveryError(message);
  if (!sanitized) return "send failed";
  if (sanitized.length > 120) return "send failed";
  if (
    /AADSTS|client_id|client_secret|smtp:|graph\.microsoft|oauth|bearer\s|authorization\s+failed/i.test(
      sanitized,
    )
  ) {
    return "send failed";
  }
  return sanitized;
}
