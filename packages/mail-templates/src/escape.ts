export type UrlValidationContext = "branding" | "template";

const BRANDING_FIELD_LABELS: Record<string, string> = {
  logo_url: "Logo URL",
  header_image_url: "Header image URL",
};

const TEMPLATE_FIELD_LABELS: Record<string, string> = {
  ticket_url: "Ticket link",
  qr_image_url: "QR image URL",
  event_map_url: "Event map image URL",
  google_maps_url: "Google Maps link",
  apple_maps_url: "Apple Maps link",
  logo_url: "Logo URL",
  header_image_url: "Header image URL",
  apple_wallet_url: "Apple Wallet link",
  google_wallet_url: "Google Wallet link",
  download_page_url: "Download page link",
};

function fieldLabel(field: string, context: UrlValidationContext): string {
  const labels = context === "branding" ? BRANDING_FIELD_LABELS : TEMPLATE_FIELD_LABELS;
  return Object.getOwnPropertyDescriptor(labels, field)?.value ?? field;
}

/** Human-readable URL validation message — shared by branding save and template render. */
export function formatInvalidUrlMessage(
  field: string,
  context: UrlValidationContext,
): string {
  const label = fieldLabel(field, context);
  if (context === "branding") {
    return `${label} must be a full http:// or https:// URL, or a valid /uploads/… image path.`;
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
  return value.replace(/[&<>"']/g, (ch) => Object.getOwnPropertyDescriptor(map, ch)?.value ?? ch);
}

/** Escape for HTML text nodes. */
export function escapeHtmlText(value: string): string {
  return escapeWithMap(value, HTML_TEXT_ESCAPE);
}

/** Escape for HTML attribute values. */
export function escapeHtmlAttribute(value: string): string {
  return escapeWithMap(value, HTML_ATTR_ESCAPE);
}

function isBrandingPathSlug(value: string, maxLength: number): boolean {
  if (value.length === 0 || value.length > maxLength) return false;
  for (const [index, char] of Array.from(value).entries()) {
    const lower = char.toLowerCase();
    const isLetter = lower >= "a" && lower <= "z";
    const isDigit = char >= "0" && char <= "9";
    if (index === 0 && !(isLetter || isDigit)) return false;
    if (!isLetter && !isDigit && char !== "_" && char !== "-") return false;
  }
  return true;
}

function hasBrandingImageExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp");
}

function isBrandingUploadPath(value: string): boolean {
  const segments = value.split("/");

  const organization = segments.at(2);
  if (!organization || !isBrandingPathSlug(organization, 64)) return false;

  const eventSegment = segments.at(3);
  const isEventAsset = eventSegment === "events";
  const event = isEventAsset ? segments.at(4) : undefined;
  const fileName = isEventAsset ? segments.at(5) : eventSegment;
  const expectedLength = isEventAsset ? 6 : 4;
  return (
    segments.length === expectedLength &&
    (!isEventAsset || (event !== undefined && isBrandingPathSlug(event, 128))) &&
    fileName !== undefined &&
    fileName.length > 0 &&
    !fileName.includes("..") &&
    hasBrandingImageExtension(fileName)
  );
}

/** Validate http(s) URL or local branding upload path; throws InvalidHttpUrlError when invalid. */
export function validateBrandingUrl(field: string, value: string): string {
  if (value === "") return "";
  const trimmed = value.trim();
  if (trimmed.startsWith("/uploads/")) {
    if (!isBrandingUploadPath(trimmed)) {
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
