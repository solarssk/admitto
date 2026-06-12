import {
  escapeHtmlAttribute,
  escapeHtmlText,
  validateHttpUrl,
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

function formatPlaceholderValue(
  name: string,
  value: string,
  inAttribute: boolean,
): string {
  if (URL_PLACEHOLDERS.has(name)) {
    assertRequiredUrlValue(name, value);
    const validated = validateHttpUrl(name, value);
    if (validated === "") return "";
    return escapeHtmlAttribute(validated);
  }
  return inAttribute ? escapeHtmlAttribute(value) : escapeHtmlText(value);
}

/** Remove empty URL-bearing attributes produced when optional URL placeholders resolve to "". */
export function stripEmptyUrlAttributes(html: string): string {
  const attrs = "src|href|action|background";
  return html
    .replace(new RegExp(`\\s(${attrs})=["']\\s*["']`, "gi"), "")
    .replace(new RegExp(`\\s(${attrs})=(?:""|'')`, "gi"), "");
}

function formatSubjectPlaceholderValue(name: string, value: string): string {
  if (URL_PLACEHOLDERS.has(name)) {
    assertRequiredUrlValue(name, value);
    return validateHttpUrl(name, value);
  }
  return value;
}

function substituteSubjectPlaceholders(template: string, vars: TemplateVars): string {
  return template.replace(VALID_PLACEHOLDER_RE, (_match, name: string) => {
    const value = resolveVarValue(name, vars);
    return formatSubjectPlaceholderValue(name, value);
  });
}

function substituteHtmlPlaceholders(template: string, vars: TemplateVars): string {
  return template.replace(VALID_PLACEHOLDER_RE, (match, name: string, offset: number) => {
    const inAttribute = isInsideQuotedAttribute(template, offset);
    const value = resolveVarValue(name, vars);
    return formatPlaceholderValue(name, value, inAttribute);
  });
}

export interface RenderTemplateInput {
  subject: string;
  compiledHtml: string;
}

export function renderTemplate(
  input: RenderTemplateInput,
  vars: TemplateVars,
): RenderedTemplate {
  const unknown = findUnknownPlaceholders(input.subject, input.compiledHtml);
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

  const subject = substituteSubjectPlaceholders(input.subject, vars);
  const html = stripEmptyUrlAttributes(
    substituteHtmlPlaceholders(input.compiledHtml, vars),
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
): RenderedTemplate {
  const subject = substituteSubjectPlaceholders(input.subject, vars);
  const html = stripEmptyUrlAttributes(
    substituteHtmlPlaceholders(input.compiledHtml, vars),
  );
  return { subject, html };
}
