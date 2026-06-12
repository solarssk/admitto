import {
  escapeHtmlAttribute,
  escapeHtmlText,
  validateHttpUrl,
} from "./escape.js";
import {
  REQUIRED_URL_PLACEHOLDERS,
  URL_PLACEHOLDERS,
  WALLET_PLACEHOLDERS,
  VALID_PLACEHOLDER_RE,
  findUnknownPlaceholders,
} from "./placeholders.js";
import {
  MissingRequiredPlaceholderError,
  UnknownPlaceholdersError,
} from "./errors.js";
import type { RenderedTemplate, TemplateVars } from "./types.js";

function isInsideAttribute(text: string, index: number): boolean {
  const before = text.slice(0, index);
  return /=\s*["'][^"']*$/.test(before);
}

function resolveVarValue(name: string, vars: TemplateVars): string {
  const raw = vars[name as keyof TemplateVars];
  if (raw === undefined || raw === null) {
    if (WALLET_PLACEHOLDERS.has(name)) return "";
    return "";
  }
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

/** Remove empty src/href attributes produced when URL placeholders resolve to "". */
export function stripEmptyUrlAttributes(html: string): string {
  return html
    .replace(/\s(src|href)=["']\s*["']/gi, "")
    .replace(/\s(src|href)=(?:""|'')/gi, "");
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
    const inAttribute = isInsideAttribute(template, offset);
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

  const subject = substituteSubjectPlaceholders(input.subject, vars);
  const html = stripEmptyUrlAttributes(
    substituteHtmlPlaceholders(input.compiledHtml, vars),
  );

  return { subject, html };
}
