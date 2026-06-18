import {
  extractPlaceholderNames,
  findUnknownPlaceholders,
  findPlaceholdersInHtmlComments,
  findUnquotedAttributePlaceholders,
  REQUIRED_URL_PLACEHOLDERS,
} from "./placeholders.js";
import {
  UnknownPlaceholdersError,
  PlaceholderInHtmlCommentError,
  UnquotedAttributePlaceholderError,
} from "./errors.js";

export interface TemplateSourceInput {
  subject: string;
  body: string;
}

/** Returns unknown placeholder names without throwing. */
export function validateTemplate(input: TemplateSourceInput): string[] {
  return findUnknownPlaceholders(input.subject, input.body);
}

function assertSafeHtmlMarkup(body: string): void {
  const inComments = findPlaceholdersInHtmlComments(body);
  if (inComments.length > 0) {
    throw new PlaceholderInHtmlCommentError(inComments);
  }
  const unquoted = findUnquotedAttributePlaceholders(body);
  if (unquoted.length > 0) {
    throw new UnquotedAttributePlaceholderError(unquoted);
  }
}

/** Throws when compiled HTML would fail render-time placeholder safety checks. */
export function assertRenderableCompiledHtml(html: string): void {
  assertSafeHtmlMarkup(html);
}

/** Returns required URL placeholder names missing from subject/body source. */
export function findMissingRequiredPlaceholders(subject: string, body: string): string[] {
  const found = new Set([
    ...extractPlaceholderNames(subject),
    ...extractPlaceholderNames(body),
  ]);
  return [...REQUIRED_URL_PLACEHOLDERS].filter((p) => !found.has(p)).sort();
}

/** Throws when the source contains unknown placeholders or unsafe HTML markup. */
export function assertValidTemplate(input: TemplateSourceInput): void {
  const unknown = validateTemplate(input);
  if (unknown.length > 0) {
    throw new UnknownPlaceholdersError(unknown);
  }
  assertSafeHtmlMarkup(input.body);
}
