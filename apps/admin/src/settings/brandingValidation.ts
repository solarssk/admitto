import type { BrandingThemeDto } from "../api/types.js";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const DEFAULT_PRIMARY = "#066fd1";

export interface BrandingFieldErrors {
  primary?: string;
  font_family_url?: string;
  font_family_name?: string;
}

export interface BrandingValidationResult {
  valid: boolean;
  errors: BrandingFieldErrors;
}

function hasFontUrl(draft: BrandingThemeDto): boolean {
  return Boolean(draft.font_family_url?.trim());
}

function hasFontName(draft: BrandingThemeDto): boolean {
  return Boolean(draft.font_family_name?.trim());
}

/** Client-side validation before PUT — mirrors server rules + font pair consistency. */
export function validateBrandingDraft(draft: BrandingThemeDto): BrandingValidationResult {
  const errors: BrandingFieldErrors = {};
  const primary = draft.primary?.trim();

  if (primary && !HEX_RE.test(primary)) {
    errors.primary = "Enter a valid 6-digit hex colour (e.g. #066fd1).";
  }

  const fontUrl = draft.font_family_url?.trim() ?? "";
  const fontName = draft.font_family_name?.trim() ?? "";

  if (fontUrl) {
    if (!fontUrl.startsWith("https://")) {
      errors.font_family_url = "Font URL must use HTTPS.";
    } else if (fontUrl.length > 2048) {
      errors.font_family_url = "Font URL must be 2048 characters or fewer.";
    }
  }

  if (fontName && fontName.length > 128) {
    errors.font_family_name = "Font name must be 128 characters or fewer.";
  }

  const urlPresent = Boolean(fontUrl);
  const namePresent = Boolean(fontName);
  if (urlPresent !== namePresent) {
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
  return primary && HEX_RE.test(primary) ? primary : DEFAULT_PRIMARY;
}

/** Normalise draft for API PUT (trim strings, omit empty fields). */
export function brandingDraftForSave(draft: BrandingThemeDto): BrandingThemeDto {
  const result: BrandingThemeDto = {};
  const primary = draft.primary?.trim();
  if (primary && HEX_RE.test(primary)) {
    result.primary = primary;
  }
  const fontUrl = draft.font_family_url?.trim();
  const fontName = draft.font_family_name?.trim();
  if (fontUrl && fontName && fontUrl.startsWith("https://")) {
    result.font_family_url = fontUrl.slice(0, 2048);
    result.font_family_name = fontName.slice(0, 128);
  }
  return result;
}
