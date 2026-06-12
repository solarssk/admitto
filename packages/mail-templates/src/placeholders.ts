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
  "apple_wallet_url",
  "google_wallet_url",
  "download_page_url",
]);

/** Placeholders validated as http(s) URLs at render time. */
export const URL_PLACEHOLDERS = new Set([
  "ticket_url",
  "qr_image_url",
  "logo_url",
  "apple_wallet_url",
  "google_wallet_url",
  "download_page_url",
]);

/** Wallet placeholders render as empty string until v0.5. */
export const WALLET_PLACEHOLDERS = new Set([
  "apple_wallet_url",
  "google_wallet_url",
  "download_page_url",
]);

const PLACEHOLDER_RE = /\{\{([a-z][a-z0-9_]*)\}\}/g;

export function extractPlaceholderNames(text: string): string[] {
  const names: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    names.push(match[1]!);
  }
  return names;
}

export function findUnknownPlaceholders(subject: string, body: string): string[] {
  const unknown = new Set<string>();
  for (const name of extractPlaceholderNames(subject)) {
    if (!ALLOWED_PLACEHOLDERS.has(name)) unknown.add(name);
  }
  for (const name of extractPlaceholderNames(body)) {
    if (!ALLOWED_PLACEHOLDERS.has(name)) unknown.add(name);
  }
  return [...unknown].sort();
}
