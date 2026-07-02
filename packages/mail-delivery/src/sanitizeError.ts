/** Strip token-like and email-like fragments from provider errors before persisting. */
export function sanitizeDeliveryError(message: string | undefined): string | undefined {
  if (!message) return undefined;
  let s = message;
  // base64url ticket tokens (~43 chars)
  s = s.replace(/[A-Za-z0-9_-]{40,60}/g, "[redacted]");
  // emails
  s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[redacted]");
  // URLs (e.g. Power Automate webhook in provider errors)
  s = s.replace(/https?:\/\/\S+/gi, "[redacted]");
  return s.slice(0, 2000);
}

/** Admin API-safe send error text — no provider internals or long opaque messages. */
export function clientSafeDeliveryError(message: string | undefined): string {
  if (!message || message.length > 120) return "send failed";
  const sanitized = sanitizeDeliveryError(message);
  if (!sanitized) return "send failed";
  if (
    /AADSTS|client_id|client_secret|smtp:|graph\.microsoft|oauth|bearer\s|authorization\s+failed|exportSink|createMailer/i.test(
      sanitized,
    )
  ) {
    return "send failed";
  }
  if (
    /https?:\/\/|[a-zA-Z0-9.-]+:\d{2,5}\b|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/i.test(sanitized)
  ) {
    return "send failed";
  }
  return sanitized;
}

/**
 * Superadmin transport test — actionable copy without hostnames, URLs, or credentials.
 * Used only for POST /api/admin/mail-settings/test (not attendee-facing mail logs).
 */
export function transportTestErrorForAdmin(message: string | undefined): string {
  if (!message?.trim()) {
    return "Send failed. Check transport settings and try again.";
  }

  const msg = message;
  if (/Cannot resolve mail provider|mail transport not configured/i.test(msg)) {
    return "Mail transport is not configured. Choose a provider and save required fields.";
  }
  if (/ECONNREFUSED/i.test(msg)) {
    return "Could not connect to the mail server (connection refused). Check host and port.";
  }
  if (/ETIMEDOUT|ETIMEOUT|socket timeout/i.test(msg)) {
    return "Mail server did not respond in time. Check host, port, and firewall.";
  }
  if (/ENOTFOUND|getaddrinfo/i.test(msg)) {
    return "Mail server hostname could not be resolved. Check the SMTP host.";
  }
  if (/\b535\b|\b534\b|authentication failed|invalid login|invalid credentials/i.test(msg)) {
    return "SMTP authentication failed. Check username and password.";
  }
  if (/certificate|STARTTLS|TLS|SSL|self[- ]signed/i.test(msg)) {
    return "TLS error talking to the mail server. Check TLS/STARTTLS settings.";
  }
  if (/\b550\b|\b553\b|mailbox unavailable|user unknown/i.test(msg)) {
    return "Server rejected the recipient or sender address.";
  }
  if (/AADSTS|invalid_client|client_secret|graph\.microsoft|oauth/i.test(msg)) {
    return "Microsoft Graph authentication failed. Check tenant, client ID, and secret.";
  }

  const generic = clientSafeDeliveryError(message);
  if (generic !== "send failed") return generic;

  return "Send failed. Verify transport settings; see server logs for the technical detail.";
}
