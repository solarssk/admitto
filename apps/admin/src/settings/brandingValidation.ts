import {
  isSafeBrandingFontUrl,
  isValidBrandingFontFamilyName,
  isValidBrandingFontWeight,
  sanitizeBrandingFontFamilyName,
} from "@admitto/ui";
import type { BrandingCustomFontFamilyDto, BrandingFontVariantDto, BrandingThemeDto } from "../api/types.js";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const DEFAULT_PRIMARY = "#066fd1";

/** True when value is a 6-digit hex colour (e.g. #066fd1). */
export function isValidHex(value: string): boolean {
  return HEX_RE.test(value);
}

export interface BrandingFieldErrors {
  primary?: string;
  font_family_name?: string;
  custom_font_families?: string;
}

export interface BrandingValidationResult {
  valid: boolean;
  errors: BrandingFieldErrors;
}

function isValidVariant(v: BrandingFontVariantDto): boolean {
  if (!isValidBrandingFontWeight(v.weight)) return false;
  if (v.style !== "normal" && v.style !== "italic") return false;
  return isSafeBrandingFontUrl(v.url);
}

function isValidFamily(f: BrandingCustomFontFamilyDto): boolean {
  return isValidBrandingFontFamilyName(f.name) && f.variants.length > 0 && f.variants.every(isValidVariant);
}

/** Client-side validation before PUT — mirrors server rules. */
export function validateBrandingDraft(draft: BrandingThemeDto): BrandingValidationResult {
  const errors: BrandingFieldErrors = {};
  const primary = draft.primary?.trim();

  if (primary && !isValidHex(primary)) {
    errors.primary = "Enter a valid 6-digit hex colour (e.g. #066fd1).";
  }

  const fontName = draft.font_family_name?.trim() ?? "";
  if (fontName && !isValidBrandingFontFamilyName(fontName)) {
    errors.font_family_name =
      "Use letters, numbers, spaces, hyphens, underscores, or periods only (max 128 characters).";
  }

  const families = draft.custom_font_families ?? [];
  if (families.length > 0 && !families.every(isValidFamily)) {
    errors.custom_font_families = "One or more saved custom fonts are invalid. Remove and re-add them.";
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

/** Normalise draft for API PUT (trim strings, omit empty/invalid fields, drop invalid families
 * and variants within an otherwise-valid family rather than the whole thing). */
export function brandingDraftForSave(draft: BrandingThemeDto): BrandingThemeDto {
  const result: BrandingThemeDto = {};
  const primary = draft.primary?.trim();
  if (primary && isValidHex(primary)) {
    result.primary = primary;
  }

  const fontName = draft.font_family_name?.trim();
  const safeFontName = fontName ? sanitizeBrandingFontFamilyName(fontName) : undefined;
  if (safeFontName) {
    result.font_family_name = safeFontName;
  }

  const validFamilies: BrandingCustomFontFamilyDto[] = [];
  for (const family of draft.custom_font_families ?? []) {
    const safeName = sanitizeBrandingFontFamilyName(family.name);
    if (!safeName) continue;
    const validVariants = family.variants.filter(isValidVariant);
    if (validVariants.length === 0) continue;
    validFamilies.push({ name: safeName, variants: validVariants });
  }
  if (validFamilies.length > 0) {
    result.custom_font_families = validFamilies;
  }

  return result;
}
