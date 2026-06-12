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

export class MjmlCompileError extends Error {
  constructor(
    public readonly errors: Array<{ message: string; formattedMessage?: string }>,
  ) {
    const detail = errors.map((e) => e.formattedMessage ?? e.message).join("; ");
    super(`MJML compilation failed: ${detail}`);
    this.name = "MjmlCompileError";
  }
}
