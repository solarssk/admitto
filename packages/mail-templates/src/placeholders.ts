import { getHtmlAttributeContext, isPlaceholderInHtmlComment } from "./htmlContext.js";

/** Closed whitelist of allowed {{snake_case}} placeholders. */
export const ALLOWED_PLACEHOLDERS = new Set([
  "first_name",
  "last_name",
  "full_name",
  "email",
  "event_name",
  "event_date",
  "event_location",
  "ticket_url",
  "qr_image_url",
  "logo_url",
  "header_image_url",
  "apple_wallet_url",
  "google_wallet_url",
  "download_page_url",
]);

/** Placeholders validated as http(s) URLs at render time. */
export const URL_PLACEHOLDERS = new Set([
  "ticket_url",
  "qr_image_url",
  "logo_url",
  "header_image_url",
  "apple_wallet_url",
  "google_wallet_url",
  "download_page_url",
]);

/** Required ticket URLs — empty/missing values fail render (not silently stripped). */
export const REQUIRED_URL_PLACEHOLDERS = new Set(["ticket_url", "qr_image_url"]);

/** Wallet placeholders render as empty string until v0.5. */
export const WALLET_PLACEHOLDERS = new Set([
  "apple_wallet_url",
  "google_wallet_url",
  "download_page_url",
]);

/** Matches any {{...}} token, including empty {{}} (malformed). */
const ANY_PLACEHOLDER_RE = /\{\{([^}]*)\}\}/g;

/** Valid placeholder name: lowercase snake_case. */
const VALID_PLACEHOLDER_NAME_RE = /^[a-z][a-z0-9_]*$/;

/** Matches only well-formed {{snake_case}} placeholders (for substitution). */
export const VALID_PLACEHOLDER_RE = /\{\{([a-z][a-z0-9_]*)\}\}/g;

/** Placeholder names inside HTML/Outlook conditional comments (unsafe for attribute context). */
export function findPlaceholdersInHtmlComments(html: string): string[] {
  const names = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(VALID_PLACEHOLDER_RE.source, "g");
  while ((match = re.exec(html)) !== null) {
    if (isPlaceholderInHtmlComment(html, match.index!)) {
      names.add(match[1]!);
    }
  }
  return [...names].sort();
}

/** Attribute names that use unquoted placeholder values (invalid / unsafe markup). */
export function findUnquotedAttributePlaceholders(html: string): string[] {
  const attributes = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(VALID_PLACEHOLDER_RE.source, "g");
  while ((match = re.exec(html)) !== null) {
    const ctx = getHtmlAttributeContext(html, match.index!);
    if (ctx.unquotedAttributeName) {
      attributes.add(ctx.unquotedAttributeName);
    }
  }
  return [...attributes].sort();
}

/** Returns inner text of every {{...}} token in the string. */
export function extractPlaceholderTokens(text: string): string[] {
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(ANY_PLACEHOLDER_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    tokens.push(match[1]!);
  }
  return tokens;
}

/** Returns whitelisted placeholder names found in the string (exact {{name}} syntax, no padding). */
export function extractPlaceholderNames(text: string): string[] {
  return extractPlaceholderTokens(text).filter(
    (token) =>
      token === token.trim() &&
      VALID_PLACEHOLDER_NAME_RE.test(token) &&
      ALLOWED_PLACEHOLDERS.has(token),
  );
}

/**
 * Returns invalid placeholder names: malformed {{...}} tokens and names outside the whitelist.
 */
export function findUnknownPlaceholders(subject: string, body: string): string[] {
  const issues = new Set<string>();
  for (const text of [subject, body]) {
    for (const token of extractPlaceholderTokens(text)) {
      const trimmed = token.trim();
      const padded = token !== trimmed;
      const name = trimmed;
      if (
        padded ||
        !VALID_PLACEHOLDER_NAME_RE.test(name) ||
        !ALLOWED_PLACEHOLDERS.has(name)
      ) {
        issues.add(name === "" ? "{{}}" : name);
      }
    }
  }
  return [...issues].sort();
}
