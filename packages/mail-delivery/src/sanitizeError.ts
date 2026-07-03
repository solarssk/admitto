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

const MAIL_TLS_VERIFY_HINT =
  "turn off Verify TLS certificate in Settings → Mail → SMTP tuning (common with corporate relays)";

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
  if (/Hostname\/IP does not match|altnames|ERR_TLS_CERT_ALTNAME_INVALID/i.test(msg)) {
    return `The SMTP hostname does not match the server's TLS certificate. Ask IT for the correct relay hostname, or ${MAIL_TLS_VERIFY_HINT}`;
  }
  if (/certificate has expired|cert has expired|CERT_HAS_EXPIRED/i.test(msg)) {
    return "The mail server's TLS certificate has expired. Contact your mail administrator.";
  }
  if (/self[- ]signed|SELF_SIGNED_CERT/i.test(msg)) {
    return `The mail server uses a certificate this instance does not trust. Ask IT to provide trust setup, or ${MAIL_TLS_VERIFY_HINT}`;
  }
  if (/unable to verify|UNABLE_TO_VERIFY|certificate chain|unknown ca|not trusted/i.test(msg)) {
    return `The mail server certificate could not be verified. Ask IT for the corporate CA/trust setup, or ${MAIL_TLS_VERIFY_HINT}`;
  }
  if (/wrong version number|SSL routines|ssl3_get_record|packet length too long/i.test(msg)) {
    return "TLS handshake failed — port and TLS mode may not match. Use port 587 with STARTTLS on, or port 465 with implicit TLS (confirm with IT).";
  }
  if (/STARTTLS not supported|STARTTLS command failed|must issue a STARTTLS/i.test(msg)) {
    return "This server does not offer STARTTLS on the chosen port. Try port 465 with STARTTLS off, or ask IT for relay settings.";
  }
  if (/certificate|STARTTLS|TLS|SSL/i.test(msg)) {
    return `TLS error talking to the mail server. Check host, port, and STARTTLS settings, or ${MAIL_TLS_VERIFY_HINT}`;
  }
  if (
    /relay access denied|relay not permitted|client host rejected|must belong to|PTR record|reverse DNS|rDNS|550 5\.7\.1|does not meet.*requirements/i.test(
      msg,
    )
  ) {
    return "The mail server rejected relay or sender identity. Ask IT to allow this host for SMTP relay or fix reverse DNS (PTR).";
  }
  if (/\b550\b|\b553\b|mailbox unavailable|user unknown/i.test(msg)) {
    return "Server rejected the recipient or sender address.";
  }
  if (/AADSTS|invalid_client|client_secret|graph\.microsoft|oauth/i.test(msg)) {
    return "Microsoft Graph authentication failed. Check tenant, client ID, and secret.";
  }

  const generic = clientSafeDeliveryError(message);
  if (generic !== "send failed") return generic;

  return "Send failed. Check transport settings or ask your administrator to review server logs.";
}
