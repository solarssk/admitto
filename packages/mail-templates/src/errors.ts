export class UnknownPlaceholdersError extends Error {
  constructor(public readonly unknown: string[]) {
    super(`Unknown template placeholders: ${unknown.join(", ")}`);
    this.name = "UnknownPlaceholdersError";
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
