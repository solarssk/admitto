export class UnknownPlaceholdersError extends Error {
  constructor(public readonly unknown: string[]) {
    super(`Unknown template placeholders: ${unknown.join(", ")}`);
    this.name = "UnknownPlaceholdersError";
  }
}

export class MissingRequiredPlaceholderError extends Error {
  constructor(public readonly placeholders: string[]) {
    super(`Missing required template values: ${placeholders.join(", ")}`);
    this.name = "MissingRequiredPlaceholderError";
  }
}

export class PlaceholderInHtmlCommentError extends Error {
  constructor(public readonly placeholders: string[]) {
    super(
      `Placeholders inside HTML or Outlook conditional comments are not allowed: ${placeholders.join(", ")}`,
    );
    this.name = "PlaceholderInHtmlCommentError";
  }
}

export class UnquotedAttributePlaceholderError extends Error {
  constructor(public readonly attributes: string[]) {
    super(
      `Placeholders in HTML tags must appear only in quoted attribute values (e.g. alt="{{first_name}}"): ${attributes.join(", ")}`,
    );
    this.name = "UnquotedAttributePlaceholderError";
  }
}

export interface MjmlRawError {
  message: string;
  formattedMessage?: string;
  /** The MJML element this error was raised on, e.g. "mj-text" - present at runtime from
   * mjml-validator's own RuleError shape, used by friendlyMjmlErrorMessage to say roughly where
   * the problem is without operators needing to read raw compiler jargon. */
  tagName?: string;
  /** Source line within the template body. */
  line?: number;
}

export class MjmlCompileError extends Error {
  constructor(public readonly errors: MjmlRawError[]) {
    const detail = errors.map((e) => e.formattedMessage ?? e.message).join("; ");
    super(`MJML compilation failed: ${detail}`);
    this.name = "MjmlCompileError";
  }
}
