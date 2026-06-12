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
