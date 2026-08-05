/**
 * Plain-English glossary for SMTP bounce codes, so an operator who does not
 * know SMTP status codes can still understand what went wrong.
 *
 * Enhanced status codes (RFC 3463, the "5.7.1" part) are more specific than
 * the base 3-digit SMTP reply code (RFC 5321, "550"), so they are checked
 * first. Only the combinations Admitto's bounce ingest actually produces are
 * covered; anything else falls back to a generic 4xx/5xx explanation.
 */

const ENHANCED_CODE_MEANINGS: Record<string, string> = {
  "5.1.0": "The recipient address does not exist.",
  "5.1.1": "The mailbox does not exist. The address is likely wrong or was closed.",
  "5.1.2": "The recipient's mail server or domain could not be found.",
  "5.1.3": "The recipient address is not a valid email address.",
  "5.1.6": "The mailbox has moved and no longer accepts mail at this address.",
  "5.2.1": "The mailbox exists but has been disabled.",
  "5.2.2": "The mailbox is full and cannot accept more mail.",
  "5.2.3": "The message was too large for the recipient's mail server.",
  "5.3.0": "The recipient's mail system reported an unspecified error.",
  "5.4.1": "The recipient's mail server did not respond.",
  "5.4.4": "The recipient's mail server could not be reached.",
  "5.4.6": "The message was relayed in a loop between mail servers.",
  "5.4.7": "The message took too long to deliver and was returned.",
  "5.5.0": "The recipient's mail server reported an unspecified protocol error.",
  "5.6.0": "The message content was rejected, for example an unsupported format.",
  "5.7.0": "The message was rejected for a security or policy reason.",
  "5.7.1": "The recipient's mail server refused the message for a policy reason, for example spam filtering or a sender rate limit.",
  "4.2.2": "The mailbox is temporarily full. It may accept mail again later.",
  "4.4.1": "The recipient's mail server did not respond in time. This may be temporary.",
  "4.4.7": "The message could not be delivered in time and was returned. This may be temporary.",
  "4.7.1": "The recipient's mail server is temporarily refusing the message, often due to spam filtering.",
};

const SMTP_CODE_MEANINGS: Record<string, string> = {
  "421": "The recipient's mail server is unavailable right now. This is usually temporary.",
  "450": "The recipient's mailbox is temporarily unavailable.",
  "451": "The recipient's mail server had a temporary internal error.",
  "452": "The recipient's mail server is out of storage. This is usually temporary.",
  "550": "The recipient's mail server rejected the address, most often because it does not exist.",
  "551": "The recipient is not handled by this mail server.",
  "552": "The recipient's mailbox is full.",
  "553": "The recipient address is not allowed by the recipient's mail server.",
  "554": "The recipient's mail server refused the message.",
};

/**
 * Explains an SMTP bounce code in plain English. Accepts the combined
 * "550/5.7.1" format used across Admitto (base SMTP code and, when known,
 * the more specific RFC 3463 enhanced status), or either part alone.
 */
export function describeSmtpBounceCode(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  const [base, enhanced] = code.split("/").map((part) => part.trim());

  if (enhanced && ENHANCED_CODE_MEANINGS[enhanced]) return ENHANCED_CODE_MEANINGS[enhanced];
  if (base && SMTP_CODE_MEANINGS[base]) return SMTP_CODE_MEANINGS[base];

  const classDigit = base?.charAt(0);
  if (classDigit === "5") return "The message was permanently rejected. It will not be retried.";
  if (classDigit === "4") return "The message was temporarily rejected. It may succeed on a retry.";
  return undefined;
}
