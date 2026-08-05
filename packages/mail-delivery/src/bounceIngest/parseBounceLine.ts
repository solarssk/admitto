import type { ParsedBounceLine } from "./types.js";

/**
 * Bounce / NDR parsing for IMAP ingest.
 *
 * Primary path: RFC 3464 `message/delivery-status` fields (Final-Recipient /
 * Original-Recipient, Action, Status, Diagnostic-Code). Human Postfix-style
 * diagnostic lines remain as a fallback when MTAs omit a structured DSN part.
 *
 * Returns [] when nothing matches — never throws.
 */

const MAX_EMAIL_LEN = 320;
const MAX_REASON_LEN = 500;

/** Bounded local + domain (no nested quantifiers) for Sonar S5843 / ReDoS safety. */
const EMAIL_RE = String.raw`([A-Z0-9][A-Z0-9._%+-]{0,62}@[A-Z0-9][A-Z0-9.-]{0,253}\.[A-Z]{2,63})`;
const HOST_SAID = String.raw`host\s+\S+(?:\s+\([^)]*\))?\s+said:\s+`;
const REPLY_TAIL = String.raw`(?:\s+\(in reply to\s+[^)]+\))?$`;

const RE_ANGLE_EMAIL = new RegExp(`<${EMAIL_RE}>`, "i");
const RE_BARE_EMAIL = new RegExp(`^${EMAIL_RE}$`, "i");
const RE_ANY_EMAIL = new RegExp(EMAIL_RE, "i");
const RE_STATUS = /^(\d)\.(\d+)\.(\d+)/;
const RE_DIAG_SMTP = /\b(\d{3})\b/;
const RE_DIAG_ENHANCED = /\b(\d\.\d\.\d)\b/;
const RE_NEAR_ORPHAN = new RegExp(
  String.raw`${EMAIL_RE}\s*(?:\n[^\n]*){0,6}\nfailed:\s+host\s+`,
  "i",
);
const RE_ANGLE_EMAIL_GI = new RegExp(`<${EMAIL_RE}>`, "gi");

function normalizeReason(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().replace(/^:\s*/, "").slice(0, MAX_REASON_LEN);
}

function lineKey(line: ParsedBounceLine): string {
  return `${line.recipientEmail}|${line.smtpCode}|${line.enhancedCode ?? ""}|${line.reason}`;
}

/** Addresses that must not be used when inferring a recipient from angle brackets or nearby context. */
function isDiscardedInferenceEmail(email: string): boolean {
  const lower = email.trim().toLowerCase();
  if (!lower || lower.length > MAX_EMAIL_LEN) return true;
  if (lower.endsWith(".mailhop.org")) return true;
  if (lower.startsWith("postmaster@")) return true;
  return false;
}

function pushLine(
  out: ParsedBounceLine[],
  seen: Set<string>,
  email: string | undefined,
  code: string | undefined,
  enhanced: string | undefined,
  reason: string | undefined,
): void {
  const recipientEmail = email?.trim().toLowerCase() ?? "";
  const smtpCode = code?.trim() ?? "";
  const reasonText = reason ? normalizeReason(reason) : "";
  if (!recipientEmail || !smtpCode || !reasonText) return;
  if (recipientEmail.length > MAX_EMAIL_LEN) return;

  const line: ParsedBounceLine = {
    recipientEmail,
    smtpCode,
    enhancedCode: enhanced?.trim() || undefined,
    reason: reasonText,
  };
  const key = lineKey(line);
  if (seen.has(key)) return;
  seen.add(key);
  out.push(line);
}

/** `rfc822; user@example.com` / `rfc822; <user@example.com>` / bare address. */
function parseAddressTypeValue(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const afterType = trimmed.includes(";")
    ? trimmed.slice(trimmed.indexOf(";") + 1).trim()
    : trimmed;
  const angled = RE_ANGLE_EMAIL.exec(afterType);
  if (angled?.[1]) return angled[1].toLowerCase();
  const bare = RE_BARE_EMAIL.exec(afterType);
  if (bare?.[1]) return bare[1].toLowerCase();
  const any = RE_ANY_EMAIL.exec(afterType);
  return any?.[1]?.toLowerCase() ?? null;
}

function parseDsnFields(block: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of block.split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon);
    if (!/^[A-Za-z0-9-]+$/.test(name)) continue;
    fields.set(name.toLowerCase(), line.slice(colon + 1).trim());
  }
  return fields;
}

function dsnActionAccepted(action: string, statusMatch: RegExpExecArray | null): boolean {
  if (action) return action === "failed" || action === "delayed";
  if (!statusMatch) return false;
  return statusMatch[1] === "4" || statusMatch[1] === "5";
}

function resolveDsnSmtpCode(
  diagnostic: string,
  statusMatch: RegExpExecArray | null,
): { smtpCode: string; enhanced: string | undefined } | null {
  const diagSmtp = RE_DIAG_SMTP.exec(diagnostic);
  const diagEnhanced = RE_DIAG_ENHANCED.exec(diagnostic);
  const enhanced = statusMatch
    ? `${statusMatch[1]}.${statusMatch[2]}.${statusMatch[3]}`
    : diagEnhanced?.[1];
  let smtpCode = diagSmtp?.[1];
  if (!smtpCode && enhanced && (enhanced.startsWith("5") || enhanced.startsWith("4"))) {
    smtpCode = `${enhanced[0]}00`;
  }
  if (!smtpCode) return null;
  return { smtpCode, enhanced };
}

function parseOneDsnBlock(block: string, out: ParsedBounceLine[], seen: Set<string>): void {
  if (!/Final-Recipient:|Original-Recipient:/i.test(block)) return;

  const fields = parseDsnFields(block);
  const action = (fields.get("action") ?? "").toLowerCase();
  const status = fields.get("status") ?? "";
  const statusMatch = RE_STATUS.exec(status);
  if (!dsnActionAccepted(action, statusMatch)) return;

  const email =
    parseAddressTypeValue(fields.get("original-recipient")) ??
    parseAddressTypeValue(fields.get("final-recipient"));
  if (!email) return;

  const diagnostic = fields.get("diagnostic-code") ?? "";
  const resolved = resolveDsnSmtpCode(diagnostic, statusMatch);
  if (!resolved) return;

  // delayed → soft (4xx class) even if Status says 5.x when Action is delayed
  const codeForClass =
    action === "delayed" && !resolved.smtpCode.startsWith("4")
      ? `4${resolved.smtpCode.slice(1)}`
      : resolved.smtpCode;
  const reason =
    diagnostic.replace(/^[^;]*;\s*/, "").trim() ||
    (resolved.enhanced
      ? `DSN status ${resolved.enhanced}`
      : `DSN action ${action || "failed"}`);

  pushLine(out, seen, email, codeForClass, resolved.enhanced, reason);
}

/**
 * Parse RFC 3464 per-recipient field groups from a delivery-status body
 * (or any text that embeds those fields).
 *
 * Only Action failed|delayed produce lines (delivered/relayed/expanded ignored).
 */
export function parseRfc3464DsnBlocks(text: string): ParsedBounceLine[] {
  if (!text) return [];
  const normalized = text.replaceAll("\r\n", "\n");
  const out: ParsedBounceLine[] = [];
  const seen = new Set<string>();

  // Split on blank lines into header-like field groups (RFC 3464 §2).
  for (const block of normalized.split(/\n(?:[ \t]*\n)+/)) {
    parseOneDsnBlock(block, out, seen);
  }

  return out;
}

function inferRecipientEmail(body: string): string | null {
  const fromDsn = parseRfc3464DsnBlocks(body)[0]?.recipientEmail;
  if (fromDsn) return fromDsn;

  const nearOrphan = RE_NEAR_ORPHAN.exec(body);
  if (nearOrphan?.[1]) {
    const candidate = nearOrphan[1].trim().toLowerCase();
    if (!isDiscardedInferenceEmail(candidate)) return candidate;
  }

  for (const match of body.matchAll(RE_ANGLE_EMAIL_GI)) {
    const email = match[1]?.trim().toLowerCase();
    if (!email || isDiscardedInferenceEmail(email)) continue;
    return email;
  }

  return null;
}

function parsePostfixFallback(normalized: string, out: ParsedBounceLine[], seen: Set<string>): void {
  const inferredEmail = inferRecipientEmail(normalized);

  const withEnhanced = new RegExp(
    String.raw`${EMAIL_RE}\s+failed:\s+${HOST_SAID}(\d{3})\s+(\d\.\d\.\d)\s+\S+:\s+(.+?)${REPLY_TAIL}`,
    "gim",
  );
  for (const match of normalized.matchAll(withEnhanced)) {
    pushLine(out, seen, match[1], match[2], match[3], match[4]);
  }

  // Also matches mailhop/Synology-style "<address>failed: host …" with no
  // colon and no space between the bracketed address and "failed:".
  const withoutStrictEnhanced = new RegExp(
    String.raw`<?${EMAIL_RE}>?\s*failed:\s+${HOST_SAID}(\d{3})\s+(?:(\d\.\d\.\d)\s+)?(?:\S+:\s+)?(.+?)${REPLY_TAIL}`,
    "gim",
  );
  for (const match of normalized.matchAll(withoutStrictEnhanced)) {
    pushLine(out, seen, match[1], match[2], match[3], match[4]);
  }

  const angleBracket = new RegExp(
    String.raw`<${EMAIL_RE}>:\s+${HOST_SAID}(\d{3})\s+(?:(\d\.\d\.\d)\s+)?(?:<[^>]+>:\s+)?(.+?)${REPLY_TAIL}`,
    "gim",
  );
  for (const match of normalized.matchAll(angleBracket)) {
    pushLine(out, seen, match[1], match[2], match[3], match[4]);
  }

  const orphanFailed = new RegExp(
    String.raw`(?:^|\n)failed:\s+${HOST_SAID}(\d{3})\s+(?:(\d\.\d\.\d)\s+)?:?\s*(.+?)${REPLY_TAIL}`,
    "gim",
  );
  for (const match of normalized.matchAll(orphanFailed)) {
    pushLine(out, seen, inferredEmail ?? undefined, match[1], match[2], match[3]);
  }
}

export function parseBounceLines(bodyText: string): ParsedBounceLine[] {
  if (!bodyText) return [];

  const normalized = bodyText.replaceAll("\r\n", "\n");
  const out: ParsedBounceLine[] = [];
  const seen = new Set<string>();

  // Prefer machine-readable DSN (RFC 3464) over human prose.
  for (const line of parseRfc3464DsnBlocks(normalized)) {
    const key = lineKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }

  parsePostfixFallback(normalized, out, seen);

  return out;
}
