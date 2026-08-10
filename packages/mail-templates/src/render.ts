import {
  escapeHtmlAttribute,
  escapeHtmlText,
  validateHttpUrl,
  BRANDING_ASSET_FIELDS,
  resolveBrandingAssetUrlForRender,
} from "./escape.js";
import { isInsideQuotedAttribute } from "./htmlContext.js";
import {
  REQUIRED_URL_PLACEHOLDERS,
  URL_PLACEHOLDERS,
  VALID_PLACEHOLDER_RE,
  findUnknownPlaceholders,
  findPlaceholdersInHtmlComments,
  findUnquotedAttributePlaceholders,
} from "./placeholders.js";
import {
  MissingRequiredPlaceholderError,
  UnknownPlaceholdersError,
  PlaceholderInHtmlCommentError,
  UnquotedAttributePlaceholderError,
} from "./errors.js";
import type { RenderedTemplate, TemplateVars } from "./types.js";

/** Ticket link placeholders kept literal in DB snapshots — substituted only at send/retry. */
export const STORAGE_DEFERRED_LINK_PLACEHOLDERS = new Set(["ticket_url", "qr_image_url"]);

function resolveVarValue(name: string, vars: TemplateVars): string {
  const raw = vars[name as keyof TemplateVars];
  if (raw === undefined || raw === null) return "";
  return String(raw);
}

function assertRequiredUrlValue(name: string, value: string): void {
  if (REQUIRED_URL_PLACEHOLDERS.has(name) && value === "") {
    throw new MissingRequiredPlaceholderError([name]);
  }
}

export interface RenderOptions {
  /** Public instance URL (`BASE_URL`) — required to absolutize `/uploads/…` branding assets in email HTML. */
  baseUrl?: string;
  /** An event's custom image asset tokens (branding asset library, v0.4.13 batch 05) - treated
   * exactly like BRANDING_ASSET_FIELDS/URL_PLACEHOLDERS members (optional, /uploads/ absolutized,
   * escaped as an attribute URL), but not known statically since names are chosen per event. */
  customAssetPlaceholders?: ReadonlySet<string>;
}

function isUrlPlaceholder(name: string, customAssetPlaceholders?: ReadonlySet<string>): boolean {
  return URL_PLACEHOLDERS.has(name) || customAssetPlaceholders?.has(name) === true;
}

function isBrandingAssetField(name: string, customAssetPlaceholders?: ReadonlySet<string>): boolean {
  return BRANDING_ASSET_FIELDS.has(name) || customAssetPlaceholders?.has(name) === true;
}

function validateUrlPlaceholder(
  name: string,
  value: string,
  baseUrl?: string,
  customAssetPlaceholders?: ReadonlySet<string>,
): string {
  if (isBrandingAssetField(name, customAssetPlaceholders)) {
    return resolveBrandingAssetUrlForRender(name, value, baseUrl);
  }
  return validateHttpUrl(name, value);
}

function formatPlaceholderValue(
  name: string,
  value: string,
  inAttribute: boolean,
  baseUrl?: string,
  customAssetPlaceholders?: ReadonlySet<string>,
): string {
  if (isUrlPlaceholder(name, customAssetPlaceholders)) {
    assertRequiredUrlValue(name, value);
    const validated = validateUrlPlaceholder(name, value, baseUrl, customAssetPlaceholders);
    if (validated === "") return "";
    return escapeHtmlAttribute(validated);
  }
  return inAttribute ? escapeHtmlAttribute(value) : escapeHtmlText(value);
}

/** Remove empty URL-bearing attributes produced when optional URL placeholders resolve to "". */
export function stripEmptyUrlAttributes(html: string): string {
  return html
    .replace(/\s(src|href|action|background)=["']\s*["']/gi, "")
    .replace(/\s(src|href|action|background)=(?:""|'')/gi, "");
}

/** Bundled ticket/wallet badge paths served from the Admitto instance (`/assets/...`). Templates
 * insert these as relative `src` values so the admin preview works same-origin; email clients need
 * an absolute URL against the public instance base (`BASE_URL`). */
const BUNDLED_TICKET_ASSET_PATHS = [
  "/assets/apple-wallet-badge.svg",
  "/assets/google-wallet-badge.svg",
] as const;

/** Rewrite known relative bundled ticket asset `src` values to absolute URLs using `baseUrl`. */
export function absolutizeBundledTicketAssetUrls(html: string, baseUrl?: string): string {
  const base = baseUrl?.replace(/\/$/, "");
  if (!base) return html;
  let out = html;
  for (const path of BUNDLED_TICKET_ASSET_PATHS) {
    const abs = `${base}${path}`;
    out = out.split(`src="${path}"`).join(`src="${abs}"`);
    out = out.split(`src='${path}'`).join(`src='${abs}'`);
  }
  return out;
}

function finalizeRenderedHtml(
  html: string,
  baseUrl?: string,
): string {
  return stripEmptyUrlAttributes(absolutizeBundledTicketAssetUrls(html, baseUrl));
}

function formatSubjectPlaceholderValue(
  name: string,
  value: string,
  baseUrl?: string,
  customAssetPlaceholders?: ReadonlySet<string>,
): string {
  if (isUrlPlaceholder(name, customAssetPlaceholders)) {
    assertRequiredUrlValue(name, value);
    return validateUrlPlaceholder(name, value, baseUrl, customAssetPlaceholders);
  }
  return value;
}

function substituteSubjectPlaceholders(
  template: string,
  vars: TemplateVars,
  baseUrl?: string,
  customAssetPlaceholders?: ReadonlySet<string>,
): string {
  return template.replace(VALID_PLACEHOLDER_RE, (_match, name: string) => {
    const value = resolveVarValue(name, vars);
    return formatSubjectPlaceholderValue(name, value, baseUrl, customAssetPlaceholders);
  });
}

function substituteSubjectPlaceholdersDeferred(
  template: string,
  vars: TemplateVars,
  baseUrl?: string,
  customAssetPlaceholders?: ReadonlySet<string>,
): string {
  return template.replace(VALID_PLACEHOLDER_RE, (match, name: string) => {
    if (STORAGE_DEFERRED_LINK_PLACEHOLDERS.has(name)) return match;
    const value = resolveVarValue(name, vars);
    return formatSubjectPlaceholderValue(name, value, baseUrl, customAssetPlaceholders);
  });
}

function substituteHtmlPlaceholders(
  template: string,
  vars: TemplateVars,
  baseUrl?: string,
  customAssetPlaceholders?: ReadonlySet<string>,
): string {
  return template.replace(VALID_PLACEHOLDER_RE, (match, name: string, offset: number) => {
    const inAttribute = isInsideQuotedAttribute(template, offset);
    const value = resolveVarValue(name, vars);
    return formatPlaceholderValue(name, value, inAttribute, baseUrl, customAssetPlaceholders);
  });
}

function substituteHtmlPlaceholdersDeferred(
  template: string,
  vars: TemplateVars,
  baseUrl?: string,
  customAssetPlaceholders?: ReadonlySet<string>,
): string {
  return template.replace(VALID_PLACEHOLDER_RE, (match, name: string, offset: number) => {
    if (STORAGE_DEFERRED_LINK_PLACEHOLDERS.has(name)) return match;
    const inAttribute = isInsideQuotedAttribute(template, offset);
    const value = resolveVarValue(name, vars);
    return formatPlaceholderValue(name, value, inAttribute, baseUrl, customAssetPlaceholders);
  });
}

function applyDeferredLinkPlaceholders(
  text: string,
  links: Pick<TemplateVars, "ticket_url" | "qr_image_url">,
  mode: "html" | "subject",
  baseUrl?: string,
): string {
  return text.replace(VALID_PLACEHOLDER_RE, (match, name: string, offset: number) => {
    if (!STORAGE_DEFERRED_LINK_PLACEHOLDERS.has(name)) return match;
    const value = links[name as keyof Pick<TemplateVars, "ticket_url" | "qr_image_url">] ?? "";
    if (mode === "subject") {
      return formatSubjectPlaceholderValue(name, value, baseUrl);
    }
    const inAttribute = isInsideQuotedAttribute(text, offset);
    return formatPlaceholderValue(name, value, inAttribute, baseUrl);
  });
}

export interface RenderTemplateInput {
  subject: string;
  compiledHtml: string;
}

export function renderTemplate(
  input: RenderTemplateInput,
  vars: TemplateVars,
  options?: RenderOptions,
): RenderedTemplate {
  const baseUrl = options?.baseUrl;
  const customAssetPlaceholders = options?.customAssetPlaceholders;
  const unknown = findUnknownPlaceholders(input.subject, input.compiledHtml, customAssetPlaceholders);
  if (unknown.length > 0) {
    throw new UnknownPlaceholdersError(unknown);
  }

  const inComments = findPlaceholdersInHtmlComments(input.compiledHtml);
  if (inComments.length > 0) {
    throw new PlaceholderInHtmlCommentError(inComments);
  }

  const unquotedAttrs = findUnquotedAttributePlaceholders(input.compiledHtml);
  if (unquotedAttrs.length > 0) {
    throw new UnquotedAttributePlaceholderError(unquotedAttrs);
  }

  const subject = substituteSubjectPlaceholders(input.subject, vars, baseUrl, customAssetPlaceholders);
  const html = finalizeRenderedHtml(
    substituteHtmlPlaceholders(input.compiledHtml, vars, baseUrl, customAssetPlaceholders),
    baseUrl,
  );

  return { subject, html };
}

/**
 * Fast render path for batch ticket sends - skips placeholder whitelist re-validation
 * (template was validated at save time). Still applies context-aware escaping.
 */
export function renderTemplateTrusted(
  input: RenderTemplateInput,
  vars: TemplateVars,
  options?: RenderOptions,
): RenderedTemplate {
  const baseUrl = options?.baseUrl;
  const customAssetPlaceholders = options?.customAssetPlaceholders;
  const subject = substituteSubjectPlaceholders(input.subject, vars, baseUrl, customAssetPlaceholders);
  const html = finalizeRenderedHtml(
    substituteHtmlPlaceholders(input.compiledHtml, vars, baseUrl, customAssetPlaceholders),
    baseUrl,
  );
  return { subject, html };
}

/**
 * Render for EmailDelivery storage - leaves {{ticket_url}} / {{qr_image_url}} literal so
 * plaintext tokens are not persisted. Apply links at send/retry via materializeStoredDeliveryMessage.
 */
export function renderTemplateTrustedForStorage(
  input: RenderTemplateInput,
  vars: TemplateVars,
  options?: RenderOptions,
): RenderedTemplate {
  const baseUrl = options?.baseUrl;
  const customAssetPlaceholders = options?.customAssetPlaceholders;
  const subject = substituteSubjectPlaceholdersDeferred(input.subject, vars, baseUrl, customAssetPlaceholders);
  const html = finalizeRenderedHtml(
    substituteHtmlPlaceholdersDeferred(input.compiledHtml, vars, baseUrl, customAssetPlaceholders),
    baseUrl,
  );
  return { subject, html };
}

/** Substitute deferred ticket link placeholders into a frozen delivery snapshot. */
export function materializeStoredDeliveryMessage(
  frozen: RenderedTemplate,
  links: Pick<TemplateVars, "ticket_url" | "qr_image_url">,
  options?: RenderOptions,
): RenderedTemplate {
  const baseUrl = options?.baseUrl;
  return {
    subject: applyDeferredLinkPlaceholders(frozen.subject, links, "subject", baseUrl),
    html: finalizeRenderedHtml(
      applyDeferredLinkPlaceholders(frozen.html, links, "html", baseUrl),
      baseUrl,
    ),
  };
}

/** Neutral inline SVG (no external request, nothing scannable) shown in place of the real QR
 * code in the admin "View sent message" preview — same 200x200 box the default ticket template
 * renders `{{qr_image_url}}` at (see defaultTemplate.ts), so custom templates sized to match also
 * look intentional rather than broken. */
const REDACTED_QR_IMAGE_DATA_URI =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">' +
      '<rect width="200" height="200" fill="#f1f3f5"/>' +
      '<rect x="0.5" y="0.5" width="199" height="199" fill="none" stroke="#ced4da"/>' +
      '<text x="100" y="94" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#495057">QR code</text>' +
      '<text x="100" y="114" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#495057">hidden for privacy</text>' +
      "</svg>",
  );

/** Inert placeholder for `{{ticket_url}}` in the redacted admin preview — not a real link. */
const REDACTED_TICKET_URL = "#";

/**
 * Substitute the deferred `{{ticket_url}}`/`{{qr_image_url}}` tokens in a frozen delivery
 * snapshot with safe, non-scannable, non-navigable placeholders — for the admin "View sent
 * message" preview only. Deliberately bypasses `materializeStoredDeliveryMessage`'s http(s)-only
 * URL validation (built for real template-author input, not this fixed trusted substitution) so
 * a `data:` URI and an inert `#` href can be used. Never substitutes the recipient's real QR
 * image or ticket link — staff must not be able to see or scan another person's ticket.
 */
export function materializeStoredDeliveryMessageRedacted(
  frozen: RenderedTemplate,
): RenderedTemplate {
  const redact = (text: string, mode: "html" | "subject"): string =>
    text.replace(VALID_PLACEHOLDER_RE, (match, name: string, offset: number) => {
      if (!STORAGE_DEFERRED_LINK_PLACEHOLDERS.has(name)) return match;
      const value = name === "qr_image_url" ? REDACTED_QR_IMAGE_DATA_URI : REDACTED_TICKET_URL;
      if (mode === "subject") return value;
      const inAttribute = isInsideQuotedAttribute(text, offset);
      return inAttribute ? escapeHtmlAttribute(value) : escapeHtmlText(value);
    });

  return {
    subject: redact(frozen.subject, "subject"),
    html: redact(frozen.html, "html"),
  };
}
