import { findUnknownPlaceholders } from "./placeholders.js";
import { UnknownPlaceholdersError } from "./errors.js";

export interface TemplateSourceInput {
  subject: string;
  body: string;
}

/** Returns unknown placeholder names without throwing. */
export function validateTemplate(input: TemplateSourceInput): string[] {
  return findUnknownPlaceholders(input.subject, input.body);
}

/** Throws UnknownPlaceholdersError when the source contains unknown placeholders. */
export function assertValidTemplate(input: TemplateSourceInput): void {
  const unknown = validateTemplate(input);
  if (unknown.length > 0) {
    throw new UnknownPlaceholdersError(unknown);
  }
}
