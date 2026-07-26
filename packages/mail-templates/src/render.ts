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
  const html = stripEmptyUrlAttributes(
    substituteHtmlPlaceholders(input.compiledHtml, vars, baseUrl, customAssetPlaceholders),
  );

  return { subject, html };
}

/**
 * Fast render path for batch ticket sends — skips placeholder whitelist re-validation
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
  const html = stripEmptyUrlAttributes(
    substituteHtmlPlaceholders(input.compiledHtml, vars, baseUrl, customAssetPlaceholders),
  );
  return { subject, html };
}

/**
 * Render for EmailDelivery storage — leaves {{ticket_url}} / {{qr_image_url}} literal so
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
  const html = stripEmptyUrlAttributes(
    substituteHtmlPlaceholdersDeferred(input.compiledHtml, vars, baseUrl, customAssetPlaceholders),
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
    html: stripEmptyUrlAttributes(
      applyDeferredLinkPlaceholders(frozen.html, links, "html", baseUrl),
    ),
  };
}
