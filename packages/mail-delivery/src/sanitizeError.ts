/** Strip token-like and email-like fragments from provider errors before persisting. */
const EMAIL_LOCAL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._%+-";
const EMAIL_DOMAIN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-";
const MAX_STORED_ERROR_LENGTH = 2000;
const MAX_EMAIL_ADDRESS_LENGTH = 320;

function hasEmailDomainShape(value: string): boolean {
  const labels = value.split(".");
  return labels.length >= 2 && labels.every((label) => label.length > 0 && label.length <= 63);
}

type EmailCandidate = { localStart: number; candidateEnd: number };

function findEmailCandidate(value: string, at: number, cursor: number): EmailCandidate {
  let localStart = at;
  while (localStart > cursor && EMAIL_LOCAL_CHARS.includes(value.charAt(localStart - 1))) {
    localStart--;
  }

  let candidateEnd = at + 1;
  while (candidateEnd < value.length && EMAIL_DOMAIN_CHARS.includes(value.charAt(candidateEnd))) {
    candidateEnd++;
  }
  while (candidateEnd > at + 1 && value.charAt(candidateEnd - 1) === ".") candidateEnd--;

  return { localStart, candidateEnd };
}

function isEmailCandidate(value: string, at: number, candidate: EmailCandidate): boolean {
  const local = value.slice(candidate.localStart, at);
  const domain = value.slice(at + 1, candidate.candidateEnd);
  return local.length > 0 && local.length <= 64 && hasEmailDomainShape(domain);
}

/** Linear email-like fragment redactor. Avoids a nested quantified regex on provider-controlled text. */
function redactEmailLikeFragments(value: string): string {
  let redacted = "";
  let cursor = 0;

  while (cursor < value.length) {
    const at = value.indexOf("@", cursor);
    if (at === -1) return redacted + value.slice(cursor);

    const candidate = findEmailCandidate(value, at, cursor);
    if (isEmailCandidate(value, at, candidate)) {
      redacted += `${value.slice(cursor, candidate.localStart)}[redacted]`;
      cursor = candidate.candidateEnd;
    } else {
      redacted += value.slice(cursor, at + 1);
      cursor = at + 1;
    }
  }

  return redacted;
}

export function sanitizeDeliveryError(message: string | undefined): string | undefined {
  if (!message) return undefined;
  let s = message.slice(0, MAX_STORED_ERROR_LENGTH + MAX_EMAIL_ADDRESS_LENGTH);
  // base64url ticket tokens (~43 chars)
  s = s.replace(/[A-Za-z0-9_-]{40,60}/g, "[redacted]");
  // emails
  s = redactEmailLikeFragments(s);
  // URLs (e.g. Power Automate webhook in provider errors)
  s = s.replace(/https?:\/\/\S+/gi, "[redacted]");
  return s.slice(0, MAX_STORED_ERROR_LENGTH);
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
    /https?:\/\//i.test(sanitized) ||
    /[a-z0-9.-]+:\d{2,5}\b/i.test(sanitized) || // NOSONAR — sanitized is derived from message, already capped at 120 chars by the guard above; worst case is a few hundred backtrack steps, not unbounded
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/i.test(sanitized)
  ) {
    return "send failed";
  }
  return sanitized;
}

const MAIL_TLS_VERIFY_HINT =
  "turn off Verify TLS certificate in Settings → Mail → SMTP tuning (common with corporate relays)";

/**
 * Ordered list of (pattern, admin-facing message) rules for `transportTestErrorForAdmin`.
 * First matching pattern wins — order mirrors the original if/else-if chain.
 */
const TRANSPORT_ERROR_RULES: ReadonlyArray<{ pattern: RegExp; message: string }> = [
  {
    pattern: /Cannot resolve mail provider|mail transport not configured/i,
    message: "Mail transport is not configured. Choose a provider and save required fields.",
  },
  {
    pattern: /ECONNREFUSED/i,
    message: "Could not connect to the mail server (connection refused). Check host and port.",
  },
  {
    pattern: /ETIMEDOUT|ETIMEOUT|socket timeout/i,
    message: "Mail server did not respond in time. Check host, port, and firewall.",
  },
  {
    pattern: /ENOTFOUND|getaddrinfo/i,
    message: "Mail server hostname could not be resolved. Check the SMTP host.",
  },
  {
    pattern: /destination is a private, loopback, or link-local address/i,
    message:
      "The SMTP host resolves to a private address. For a local lab set ALLOW_PRIVATE_MAIL_DESTINATIONS=true, otherwise use a public host.",
  },
  {
    pattern: /hostname could not be resolved/i,
    message: "Mail server hostname could not be resolved. Check the SMTP host.",
  },
  {
    pattern: /Mailbox doesn'?t exist|NonExistentMailbox|NO \[NONEXISTENT\]/i,
    message: "That folder was not found on the mailbox. Check Folders to check (names vary by server).",
  },
  {
    pattern: /\b535\b|\b534\b|authentication failed|invalid login|invalid credentials/i,
    message: "SMTP authentication failed. Check username and password.",
  },
  {
    pattern: /Hostname\/IP does not match|altnames|ERR_TLS_CERT_ALTNAME_INVALID/i,
    message: `The SMTP hostname does not match the server's TLS certificate. Ask IT for the correct relay hostname, or ${MAIL_TLS_VERIFY_HINT}`,
  },
  {
    pattern: /certificate has expired|cert has expired|CERT_HAS_EXPIRED/i,
    message: "The mail server's TLS certificate has expired. Contact your mail administrator.",
  },
  {
    pattern: /self[- ]signed|SELF_SIGNED_CERT/i,
    message: `The mail server uses a certificate this instance does not trust. Ask IT to provide trust setup, or ${MAIL_TLS_VERIFY_HINT}`,
  },
  {
    pattern: /unable to verify|UNABLE_TO_VERIFY|certificate chain|unknown ca|not trusted/i,
    message: `The mail server certificate could not be verified. Ask IT for the corporate CA/trust setup, or ${MAIL_TLS_VERIFY_HINT}`,
  },
  {
    pattern: /wrong version number|SSL routines|ssl3_get_record|packet length too long/i,
    message:
      "TLS handshake failed. Port and TLS mode may not match. Use port 587 with STARTTLS on, or port 465 with implicit TLS (confirm with IT).",
  },
  {
    pattern: /STARTTLS not supported|STARTTLS command failed|must issue a STARTTLS/i,
    message:
      "This server does not offer STARTTLS on the chosen port. Try port 465 with STARTTLS off, or ask IT for relay settings.",
  },
  {
    pattern: /certificate|STARTTLS|TLS|SSL/i,
    message: `TLS error talking to the mail server. Check host, port, and STARTTLS settings, or ${MAIL_TLS_VERIFY_HINT}`,
  },
  {
    pattern:
      /relay access denied|relay not permitted|client host rejected|must belong to|PTR record|reverse DNS|rDNS|550 5\.7\.1|does not meet.*requirements/i,
    message:
      "The mail server rejected relay or sender identity. Ask IT to allow this host for SMTP relay or fix reverse DNS (PTR).",
  },
  {
    pattern: /\b550\b|\b553\b|mailbox unavailable|user unknown/i,
    message: "Server rejected the recipient or sender address.",
  },
  {
    pattern: /AADSTS|invalid_client|client_secret|graph\.microsoft|oauth/i,
    message: "Microsoft Graph authentication failed. Check tenant, client ID, and secret.",
  },
];

/**
 * Superadmin transport test — actionable copy without hostnames, URLs, or credentials.
 * Used only for POST /api/admin/mail-settings/test (not attendee-facing mail logs).
 */
export function transportTestErrorForAdmin(message: string | undefined): string {
  if (!message?.trim()) {
    return "Send failed. Check transport settings and try again.";
  }

  const matchedRule = TRANSPORT_ERROR_RULES.find((rule) => rule.pattern.test(message));
  if (matchedRule) {
    return matchedRule.message;
  }

  const generic = clientSafeDeliveryError(message);
  if (generic !== "send failed") return generic;

  return "Send failed. Check transport settings or ask your administrator to review server logs.";
}

/**
 * Bounce IMAP connection test — same sanitization as transport test, with IMAP wording
 * (never leak getaddrinfo / hostnames to the admin UI).
 */
export function imapTestErrorForAdmin(message: string | undefined): string {
  if (!message?.trim()) {
    return "Could not connect. Check IMAP settings and try again.";
  }

  const smtpFacing = transportTestErrorForAdmin(message);
  return smtpFacing
    .replaceAll("SMTP host", "IMAP host")
    .replaceAll("SMTP authentication", "IMAP authentication")
    .replace(/^Send failed\./, "Could not connect.")
    .replaceAll("Check transport settings", "Check IMAP settings");
}
