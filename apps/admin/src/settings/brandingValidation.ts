import type { BrandingThemeDto } from "../api/types.js";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const DEFAULT_PRIMARY = "#066fd1";

export function isValidHex(value: string): boolean {
  return HEX_RE.test(value);
}

export interface BrandingFieldErrors {
  primary?: string;
  font_family_url?: string;
  font_family_name?: string;
}

export interface BrandingValidationResult {
  valid: boolean;
  errors: BrandingFieldErrors;
}

function isValidHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Client-side validation before PUT — mirrors server rules + font pair consistency. */
export function validateBrandingDraft(draft: BrandingThemeDto): BrandingValidationResult {
  const errors: BrandingFieldErrors = {};
  const primary = draft.primary?.trim();

  if (primary && !isValidHex(primary)) {
    errors.primary = "Enter a valid 6-digit hex colour (e.g. #066fd1).";
  }

  const fontUrl = draft.font_family_url?.trim() ?? "";
  const fontName = draft.font_family_name?.trim() ?? "";

  if (fontUrl) {
    if (!isValidHttpsUrl(fontUrl)) {
      errors.font_family_url = "Font URL must be a valid HTTPS URL.";
    } else if (fontUrl.length > 2048) {
      errors.font_family_url = "Font URL must be 2048 characters or fewer.";
    }
  }

  if (fontName && fontName.length > 128) {
    errors.font_family_name = "Font name must be 128 characters or fewer.";
  }

  const urlPresent = Boolean(fontUrl);
  const namePresent = Boolean(fontName);
  if (urlPresent !== namePresent && !errors.font_family_url) {
    const pairMessage = "Provide both font name and HTTPS URL, or leave both empty.";
    if (!urlPresent) errors.font_family_url = pairMessage;
    if (!namePresent) errors.font_family_name = pairMessage;
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/** Hex value for color picker input (always a valid 6-digit hex). */
export function primaryForColorInput(primary?: string): string {
  return primary && isValidHex(primary) ? primary : DEFAULT_PRIMARY;
}

/** Normalise draft for API PUT (trim strings, omit empty fields). */
export function brandingDraftForSave(draft: BrandingThemeDto): BrandingThemeDto {
  const result: BrandingThemeDto = {};
  const primary = draft.primary?.trim();
  if (primary && isValidHex(primary)) {
    result.primary = primary;
  }
  const fontUrl = draft.font_family_url?.trim();
  const fontName = draft.font_family_name?.trim();
  if (fontUrl && fontName && isValidHttpsUrl(fontUrl)) {
    result.font_family_url = fontUrl.slice(0, 2048);
    result.font_family_name = fontName.slice(0, 128);
  }
  return result;
}
