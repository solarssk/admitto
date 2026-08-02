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
  "event_map_url",
  "event_address",
  "directions_text",
  "accessibility_text",
  "google_maps_url",
  "apple_maps_url",
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
  "event_map_url",
  "google_maps_url",
  "apple_maps_url",
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

/**
 * Placeholders meant to be embedded as an image (`<img src>` / `<mj-image src>`), not a link
 * href or plain text. Used by the admin template editor to insert a ready-to-use image element
 * instead of a bare `{{name}}` token when a user clicks one of these in the placeholder picker —
 * without this, clicking e.g. `{{logo_url}}` just drops inert text into the body, which for an
 * image placeholder never displays anything on its own.
 */
export const IMAGE_PLACEHOLDERS = new Set([
  "logo_url",
  "header_image_url",
  "qr_image_url",
  "event_map_url",
]);

/** Valid placeholder name: lowercase snake_case. */
const VALID_PLACEHOLDER_NAME_RE = /^[a-z][a-z0-9_]*$/;

/** Matches only well-formed {{snake_case}} placeholders (for substitution). */
export const VALID_PLACEHOLDER_RE = /\{\{([a-z][a-z0-9_]*)\}\}/g;

/** Placeholder names inside HTML/Outlook conditional comments (unsafe for attribute context). */
export function findPlaceholdersInHtmlComments(html: string): string[] {
  const names = new Set<string>();
  let match: RegExpExecArray | null;
  const re = /\{\{([a-z][a-z0-9_]*)\}\}/g;
  while ((match = re.exec(html)) !== null) {
    if (isPlaceholderInHtmlComment(html, match.index!)) {
      names.add(match[1]!);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Attribute names that use unquoted placeholder values (invalid / unsafe markup). */
export function findUnquotedAttributePlaceholders(html: string): string[] {
  const attributes = new Set<string>();
  let match: RegExpExecArray | null;
  const re = /\{\{([a-z][a-z0-9_]*)\}\}/g;
  while ((match = re.exec(html)) !== null) {
    const ctx = getHtmlAttributeContext(html, match.index!);
    if (ctx.unquotedAttributeName) {
      attributes.add(ctx.unquotedAttributeName);
    } else if (ctx.inBareTagMarkup) {
      attributes.add(`{{${match[1]!}}}`);
    }
  }
  return [...attributes].sort((a, b) => a.localeCompare(b));
}

/** Returns inner text of every {{...}} token in the string. */
export function extractPlaceholderTokens(text: string): string[] {
  const tokens: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("{{", cursor);
    if (start === -1) break;

    const firstClosingBrace = text.indexOf("}", start + 2);
    if (firstClosingBrace === -1) break;
    if (text.charAt(firstClosingBrace + 1) !== "}") {
      cursor = firstClosingBrace + 1;
      continue;
    }

    tokens.push(text.slice(start + 2, firstClosingBrace));
    cursor = firstClosingBrace + 2;
  }
  return tokens;
}

/**
 * Returns whitelisted placeholder names found in the string (exact {{name}} syntax, no
 * padding). `extraAllowed` widens the whitelist per-call — used for an event's custom image
 * asset tokens (branding asset library), which aren't known ahead of time like the static list.
 */
export function extractPlaceholderNames(
  text: string,
  extraAllowed?: ReadonlySet<string>,
): string[] {
  return extractPlaceholderTokens(text).filter(
    (token) =>
      token === token.trim() &&
      VALID_PLACEHOLDER_NAME_RE.test(token) &&
      (ALLOWED_PLACEHOLDERS.has(token) || extraAllowed?.has(token) === true),
  );
}

/**
 * Returns invalid placeholder names: malformed {{...}} tokens and names outside the whitelist
 * (static list plus `extraAllowed`, e.g. an event's custom image asset tokens).
 */
export function findUnknownPlaceholders(
  subject: string,
  body: string,
  extraAllowed?: ReadonlySet<string>,
): string[] {
  const issues = new Set<string>();
  for (const text of [subject, body]) {
    for (const token of extractPlaceholderTokens(text)) {
      const trimmed = token.trim();
      const padded = token !== trimmed;
      const name = trimmed;
      if (
        padded ||
        !VALID_PLACEHOLDER_NAME_RE.test(name) ||
        !(ALLOWED_PLACEHOLDERS.has(name) || extraAllowed?.has(name) === true)
      ) {
        issues.add(name === "" ? "{{}}" : name);
      }
    }
  }
  return [...issues].sort((a, b) => a.localeCompare(b));
}
