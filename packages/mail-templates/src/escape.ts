export type UrlValidationContext = "branding" | "template";

const BRANDING_FIELD_LABELS: Record<string, string> = {
  logo_url: "Logo URL",
  header_image_url: "Header image URL",
};

const TEMPLATE_FIELD_LABELS: Record<string, string> = {
  ticket_url: "Ticket link",
  qr_image_url: "QR image URL",
  logo_url: "Logo URL",
  header_image_url: "Header image URL",
  apple_wallet_url: "Apple Wallet link",
  google_wallet_url: "Google Wallet link",
  download_page_url: "Download page link",
};

function fieldLabel(field: string, context: UrlValidationContext): string {
  const labels = context === "branding" ? BRANDING_FIELD_LABELS : TEMPLATE_FIELD_LABELS;
  return labels[field] ?? field;
}

/** Human-readable URL validation message — shared by branding save and template render. */
export function formatInvalidUrlMessage(
  field: string,
  context: UrlValidationContext,
): string {
  const label = fieldLabel(field, context);
  if (context === "branding") {
    return `${label} must be a full http:// or https:// URL.`;
  }
  return `${label} must be a full http:// or https:// URL when rendering the email.`;
}

export class InvalidHttpUrlError extends Error {
  constructor(
    public readonly field: string,
    public readonly value: string,
    public readonly context: UrlValidationContext = "template",
  ) {
    super(formatInvalidUrlMessage(field, context));
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

const BRANDING_UPLOAD_PATH =
  /^\/uploads\/[a-z0-9][a-z0-9_-]{0,63}(\/events\/[a-z0-9][a-z0-9_-]{0,127})?\/[^/]+\.(png|jpe?g|webp)$/i;

/** Validate http(s) URL or local branding upload path; throws InvalidHttpUrlError when invalid. */
export function validateBrandingUrl(field: string, value: string): string {
  if (value === "") return "";
  const trimmed = value.trim();
  if (trimmed.startsWith("/uploads/")) {
    if (trimmed.includes("..") || !BRANDING_UPLOAD_PATH.test(trimmed)) {
      throw new InvalidHttpUrlError(field, value, "branding");
    }
    return trimmed;
  }
  return validateHttpUrl(field, trimmed, "branding");
}

/** Branding asset placeholders that may be stored as `/uploads/…` paths. */
export const BRANDING_ASSET_FIELDS = new Set(["logo_url", "header_image_url"]);

/**
 * Validate and absolutize a branding asset URL for email HTML (Outlook/Gmail need absolute https).
 * Relative `/uploads/…` paths require `baseUrl` (typically from `BASE_URL` env).
 */
export function resolveBrandingAssetUrlForRender(
  field: string,
  value: string,
  baseUrl?: string,
): string {
  if (value === "") return "";
  const validated = validateBrandingUrl(field, value);
  if (validated.startsWith("/uploads/")) {
    const base = baseUrl?.replace(/\/$/, "") ?? "";
    if (!base) {
      throw new InvalidHttpUrlError(field, value, "template");
    }
    return validateHttpUrl(field, `${base}${validated}`, "template");
  }
  return validateHttpUrl(field, validated, "template");
}

/** Validate http(s) URL; throws InvalidHttpUrlError when non-empty and invalid. */
export function validateHttpUrl(
  field: string,
  value: string,
  context: UrlValidationContext = "template",
): string {
  if (value === "") return "";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidHttpUrlError(field, value, context);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidHttpUrlError(field, value, context);
  }
  return value;
}
