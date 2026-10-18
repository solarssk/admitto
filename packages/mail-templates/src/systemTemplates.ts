/** The one template per scope that ticket delivery actually sends - the only one required to
 * carry `ticket_url`/`qr_image_url` (see REQUIRED_URL_PLACEHOLDERS). Every other event template
 * is free-form. */
export const DEFAULT_TEMPLATE_NAME = "ticket";

/**
 * System mails sent to a guest before an Attendee exists (registration form, v0.8). Each has a
 * built-in default; an override is an ordinary `MailTemplate` row under the same name. The names
 * carry a hyphen, so a free label ("New template" slugs to `_`) can never produce one, but an
 * override is still an ordinary row - so everything that lists, counts, sends or protects event
 * templates asks {@link isSystemTemplateName} instead of comparing literals. `ticket` is not in
 * this list: it stays the one template ticket delivery sends, in the list and in bulk send.
 */
export const SYSTEM_TEMPLATE_NAMES = [
  "registration-confirm",
  "registration-received",
  "registration-waitlist",
  "registration-rejected",
] as const;

export type SystemTemplateName = (typeof SYSTEM_TEMPLATE_NAMES)[number];

const SYSTEM_TEMPLATE_NAME_SET: ReadonlySet<string> = new Set(SYSTEM_TEMPLATE_NAMES);

export function isSystemTemplateName(name: string): name is SystemTemplateName {
  return SYSTEM_TEMPLATE_NAME_SET.has(name);
}

/** Names a free-form template must never take: `ticket` and every system template. */
export function isReservedTemplateName(name: string): boolean {
  return name === DEFAULT_TEMPLATE_NAME || isSystemTemplateName(name);
}

/** Ticket, QR and wallet links belong to an Attendee. A registration mail goes out before one
 * exists, so these have no value there: `render.ts` would throw `MissingRequiredPlaceholderError`
 * on an empty `ticket_url`, and a wallet or download link would be dead. */
export const SYSTEM_TEMPLATE_FORBIDDEN_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "ticket_url",
  "qr_image_url",
  "apple_wallet_url",
  "google_wallet_url",
  "download_page_url",
]);

/** Placeholders a template of this name must not use (empty for every non-system name). Pass it
 * as the `disallowed` argument of `validateTemplate` / `assertValidTemplate`. */
export function disallowedPlaceholdersForTemplate(name: string): ReadonlySet<string> | undefined {
  return isSystemTemplateName(name) ? SYSTEM_TEMPLATE_FORBIDDEN_PLACEHOLDERS : undefined;
}
