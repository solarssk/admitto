import { isSafeBrandingFontUrl, isValidBrandingFontFamilyName, sanitizeBrandingFontFamilyName } from "@admitto/ui";
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

function fontUrlHasCredentials(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password);
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
    if (fontUrlHasCredentials(fontUrl)) {
      errors.font_family_url = "Font URL must not contain embedded credentials.";
    } else if (!isSafeBrandingFontUrl(fontUrl)) {
      errors.font_family_url = "Font URL must be a valid HTTPS URL.";
    }
  }

  if (fontName) {
    if (!isValidBrandingFontFamilyName(fontName)) {
      errors.font_family_name =
        "Use letters, numbers, spaces, hyphens, underscores, or periods only (max 128 characters).";
    }
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
  const safeFontName = fontName ? sanitizeBrandingFontFamilyName(fontName) : undefined;
  if (fontUrl && safeFontName && isSafeBrandingFontUrl(fontUrl)) {
    result.font_family_url = fontUrl;
    result.font_family_name = safeFontName;
  }
  return result;
}
