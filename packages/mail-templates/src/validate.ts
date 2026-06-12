import {
  findUnknownPlaceholders,
  findPlaceholdersInHtmlComments,
  findUnquotedAttributePlaceholders,
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

/** Throws when the source contains unknown placeholders or unsafe HTML markup. */
export function assertValidTemplate(input: TemplateSourceInput): void {
  const unknown = validateTemplate(input);
  if (unknown.length > 0) {
    throw new UnknownPlaceholdersError(unknown);
  }
  assertSafeHtmlMarkup(input.body);
}
