export class InvalidHttpUrlError extends Error {
  constructor(
    public readonly field: string,
    public readonly value: string,
  ) {
    super(`Invalid HTTP(S) URL for placeholder "${field}"`);
    this.name = "InvalidHttpUrlError";
  }
}

const HTML_TEXT_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

const HTML_ATTR_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeWithMap(value: string, map: Record<string, string>): string {
  return value.replace(/[&<>"']/g, (ch) => map[ch] ?? ch);
}

/** Escape for HTML text nodes. */
export function escapeHtmlText(value: string): string {
  return escapeWithMap(value, HTML_TEXT_ESCAPE);
}

/** Escape for HTML attribute values. */
export function escapeHtmlAttribute(value: string): string {
  return escapeWithMap(value, HTML_ATTR_ESCAPE);
}

/** Validate http(s) URL; throws InvalidHttpUrlError when non-empty and invalid. */
export function validateHttpUrl(field: string, value: string): string {
  if (value === "") return "";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidHttpUrlError(field, value);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidHttpUrlError(field, value);
  }
  return value;
}
