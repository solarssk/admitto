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

/** Linear email pattern (no nested quantifiers) so Sonar S8786 does not flag ReDoS on NDR bodies. */
const EMAIL_RE =
  "([A-Z0-9](?:[A-Z0-9._%+-]{0,62}[A-Z0-9])?@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+)";
const HOST_SAID = "host\\s+\\S+(?:\\s+\\([^)]*\\))?\\s+said:\\s+";
const REPLY_TAIL = "(?:\\s+\\(in reply to\\s+[^)]+\\))?$";

function normalizeReason(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().replace(/^:\s*/, "").slice(0, MAX_REASON_LEN);
}

function lineKey(line: ParsedBounceLine): string {
  return `${line.recipientEmail}|${line.smtpCode}|${line.enhancedCode ?? ""}|${line.reason}`;
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
  const angled = afterType.match(new RegExp(`<${EMAIL_RE}>`, "i"));
  if (angled?.[1]) return angled[1].toLowerCase();
  const bare = afterType.match(new RegExp(`^${EMAIL_RE}$`, "i"));
  if (bare?.[1]) return bare[1].toLowerCase();
  const any = afterType.match(new RegExp(EMAIL_RE, "i"));
  return any?.[1]?.toLowerCase() ?? null;
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
  const blocks = normalized.split(/\n(?:[ \t]*\n)+/);
  for (const block of blocks) {
    if (!/Final-Recipient:|Original-Recipient:/i.test(block)) continue;

    const fields = new Map<string, string>();
    for (const line of block.split("\n")) {
      // Bounded field name + rest-of-line value (no unbounded `(.*)$` backtracking).
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      const name = line.slice(0, colon);
      if (!/^[A-Za-z0-9-]+$/.test(name)) continue;
      fields.set(name.toLowerCase(), line.slice(colon + 1).trim());
    }

    const action = (fields.get("action") ?? "").toLowerCase();
    // Missing Action: still accept if Status looks like a failure (some gateways).
    const status = fields.get("status") ?? "";
    const statusMatch = status.match(/^(\d)\.(\d+)\.(\d+)/);
    if (action) {
      if (action !== "failed" && action !== "delayed") continue;
    } else if (!statusMatch || (statusMatch[1] !== "4" && statusMatch[1] !== "5")) {
      continue;
    }

    const email =
      parseAddressTypeValue(fields.get("original-recipient")) ??
      parseAddressTypeValue(fields.get("final-recipient"));
    if (!email) continue;

    const diagnostic = fields.get("diagnostic-code") ?? "";
    const diagSmtp = diagnostic.match(/\b(\d{3})\b/);
    const diagEnhanced = diagnostic.match(/\b(\d\.\d\.\d)\b/);
    const enhanced = statusMatch ? `${statusMatch[1]}.${statusMatch[2]}.${statusMatch[3]}` : diagEnhanced?.[1];
    const smtpCode =
      diagSmtp?.[1] ??
      (enhanced?.startsWith("5") || enhanced?.startsWith("4") ? `${enhanced[0]}00` : undefined);
    if (!smtpCode) continue;

    // delayed → soft (4xx class) even if Status says 5.x when Action is delayed
    const codeForClass =
      action === "delayed" && !smtpCode.startsWith("4") ? `4${smtpCode.slice(1)}` : smtpCode;
    const reason =
      diagnostic.replace(/^[^;]*;\s*/, "").trim() ||
      (enhanced ? `DSN status ${enhanced}` : `DSN action ${action || "failed"}`);

    pushLine(out, seen, email, codeForClass, enhanced, reason);
  }

  return out;
}

function inferRecipientEmail(body: string): string | null {
  const fromDsn = parseRfc3464DsnBlocks(body)[0]?.recipientEmail;
  if (fromDsn) return fromDsn;

  const nearOrphan = body.match(
    new RegExp(`${EMAIL_RE}\\s*(?:\\n[^\\n]*){0,6}\\nfailed:\\s+host\\s+`, "i"),
  );
  if (nearOrphan?.[1]) return nearOrphan[1]!.trim().toLowerCase();

  for (const match of body.matchAll(new RegExp(`<${EMAIL_RE}>`, "gi"))) {
    const email = match[1]?.trim().toLowerCase();
    if (!email || email.length > MAX_EMAIL_LEN) continue;
    if (email.endsWith(".mailhop.org") || email.startsWith("postmaster@")) continue;
    return email;
  }

  return null;
}

function parsePostfixFallback(normalized: string, out: ParsedBounceLine[], seen: Set<string>): void {
  const inferredEmail = inferRecipientEmail(normalized);

  const withEnhanced = new RegExp(
    `${EMAIL_RE}\\s+failed:\\s+${HOST_SAID}(\\d{3})\\s+(\\d\\.\\d\\.\\d)\\s+\\S+:\\s+(.+?)${REPLY_TAIL}`,
    "gim",
  );
  for (const match of normalized.matchAll(withEnhanced)) {
    pushLine(out, seen, match[1], match[2], match[3], match[4]);
  }

  // Also matches mailhop/Synology-style "<address>failed: host …" with no
  // colon and no space between the bracketed address and "failed:".
  const withoutStrictEnhanced = new RegExp(
    `<?${EMAIL_RE}>?\\s*failed:\\s+${HOST_SAID}(\\d{3})\\s+(?:(\\d\\.\\d\\.\\d)\\s+)?(?:\\S+:\\s+)?(.+?)${REPLY_TAIL}`,
    "gim",
  );
  for (const match of normalized.matchAll(withoutStrictEnhanced)) {
    pushLine(out, seen, match[1], match[2], match[3], match[4]);
  }

  const angleBracket = new RegExp(
    `<${EMAIL_RE}>:\\s+${HOST_SAID}(\\d{3})\\s+(?:(\\d\\.\\d\\.\\d)\\s+)?(?:<[^>]+>:\\s+)?(.+?)${REPLY_TAIL}`,
    "gim",
  );
  for (const match of normalized.matchAll(angleBracket)) {
    pushLine(out, seen, match[1], match[2], match[3], match[4]);
  }

  const orphanFailed = new RegExp(
    `(?:^|\\n)failed:\\s+${HOST_SAID}(\\d{3})\\s+(?:(\\d\\.\\d\\.\\d)\\s+)?:?\\s*(.+?)${REPLY_TAIL}`,
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
