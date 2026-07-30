import type { PrismaClient, Prisma } from "@prisma/client";
import { getSetting } from "./resolver.js";
import { SETTING_BRANDING_THEME } from "./keys.js";

/** Mirror @admitto/ui's BrandingFontVariant — auth must not depend on @admitto/ui. */
export interface BrandingFontVariant {
  weight: number;
  style: "normal" | "italic";
  url: string;
}

/** Mirror @admitto/ui's BrandingCustomFontFamily — a saved custom family's name + every
 * weight/style file uploaded for it, kept as a library so switching back to a previously-
 * uploaded family doesn't need re-uploading. */
export interface BrandingCustomFontFamily {
  name: string;
  variants: BrandingFontVariant[];
}

export interface BrandingTheme {
  primary?: string;
  /** The active pick - either a built-in name (e.g. "Manrope") or one of custom_font_families[].name. */
  font_family_name?: string;
  custom_font_families?: BrandingCustomFontFamily[];
}

// Matches the admin UI's own weight (100-900 in six 100-800 presets) x style (normal/italic)
// combo space - a generous upper bound on how many @font-face variants one family can have.
const MAX_FONT_VARIANTS = 12;
// How many distinct custom families an org can keep saved at once - generous, but bounded.
const MAX_CUSTOM_FAMILIES = 8;

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** Mirror @admitto/ui sanitizeBrandingFontFamilyName — auth must not depend on @admitto/ui. */
function sanitizeBrandingFontFamilyName(name: string): string | undefined {
  const cleaned = name.trim().replace(/[^A-Za-z0-9 \-_.]/g, "").slice(0, 128);
  return cleaned || undefined;
}

// Mirror @admitto/ui's BRANDING_FONT_UPLOAD_PATH — auth must not depend on @admitto/ui. Filename
// stem restricted to a safe charset (not just "no slash") - this is the real server-side
// boundary a crafted PUT /api/staff/theme has to go through, and @admitto/ui's fontFaceRuleFor
// later interpolates whatever this accepts as "local" straight into @font-face CSS unescaped.
const BRANDING_FONT_UPLOAD_PATH = /^\/uploads\/[a-z0-9][a-z0-9_-]{0,63}\/theme\/[a-z0-9_-]+\.(woff2?|ttf|otf)$/i;

function isLocalBrandingFontPath(url: string): boolean {
  return url.startsWith("/uploads/") && !url.includes("..") && BRANDING_FONT_UPLOAD_PATH.test(url);
}

/** Mirror @admitto/ui isSafeBrandingFontUrl — auth must not depend on @admitto/ui. */
function isSafeBrandingFontUrl(url: string): boolean {
  if (isLocalBrandingFontPath(url)) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    if (url.length > 2048) return false;
    return true;
  } catch {
    return false;
  }
}

function isValidFontWeight(weight: unknown): weight is number {
  return typeof weight === "number" && Number.isInteger(weight) && weight >= 100 && weight <= 900;
}

/** Drop malformed entries rather than rejecting the whole array - one bad variant (e.g. from a
 * hand-edited request) shouldn't take down every other valid one. */
function sanitizeFontVariants(raw: unknown): BrandingFontVariant[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const variants: BrandingFontVariant[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (!isValidFontWeight(e.weight)) continue;
    if (e.style !== "normal" && e.style !== "italic") continue;
    if (typeof e.url !== "string" || !isSafeBrandingFontUrl(e.url)) continue;
    variants.push({ weight: e.weight, style: e.style, url: e.url });
    if (variants.length >= MAX_FONT_VARIANTS) break;
  }
  return variants.length > 0 ? variants : undefined;
}

/** Drop malformed families and dedupe by (sanitized) name - a family with zero valid variants
 * left after sanitizing isn't a usable family, so it's dropped entirely rather than kept empty. */
function sanitizeCustomFontFamilies(raw: unknown): BrandingCustomFontFamily[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const families: BrandingCustomFontFamily[] = [];
  const seenNames = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== "string") continue;
    const name = sanitizeBrandingFontFamilyName(e.name);
    if (!name || seenNames.has(name)) continue;
    const variants = sanitizeFontVariants(e.variants);
    if (!variants) continue;
    seenNames.add(name);
    families.push({ name, variants });
    if (families.length >= MAX_CUSTOM_FAMILIES) break;
  }
  return families.length > 0 ? families : undefined;
}

/** A record saved by the single-file predecessor of custom_font_families still has
 * font_family_name + font_family_url and nothing else describing the custom font - converted
 * into a one-variant family here (matching the old renderer's own implicit weight 400 normal, the
 * only style it ever supported) so upgrading doesn't silently drop an org's configured font on
 * its very first read, or lose the file for good the next time the theme is saved through the
 * new UI (which has no field for the old shape at all). */
function migrateLegacyFontUrl(o: Record<string, unknown>): BrandingCustomFontFamily[] | undefined {
  if (Array.isArray(o.custom_font_families)) return undefined;
  if (typeof o.font_family_url !== "string" || typeof o.font_family_name !== "string") return undefined;
  const name = sanitizeBrandingFontFamilyName(o.font_family_name);
  if (!name || !isSafeBrandingFontUrl(o.font_family_url)) return undefined;
  return [{ name, variants: [{ weight: 400, style: "normal", url: o.font_family_url }] }];
}

function sanitizeTheme(raw: unknown): BrandingTheme {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const primary = typeof o.primary === "string" && HEX_RE.test(o.primary) ? o.primary : undefined;
  const font_family_name =
    typeof o.font_family_name === "string"
      ? sanitizeBrandingFontFamilyName(o.font_family_name)
      : undefined;
  const custom_font_families = sanitizeCustomFontFamilies(o.custom_font_families) ?? migrateLegacyFontUrl(o);
  return { primary, font_family_name, custom_font_families };
}

/** Load branding theme from SystemSettings (env > DB > default). */
export async function getBrandingTheme(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<BrandingTheme> {
  const raw = await getSetting<unknown>(prisma, SETTING_BRANDING_THEME);
  return sanitizeTheme(raw);
}

/** Persist branding theme (superadmin UI). */
export async function setBrandingTheme(
  prisma: PrismaClient | Prisma.TransactionClient,
  theme: BrandingTheme,
): Promise<void> {
  const { setSetting } = await import("./resolver.js");
  await setSetting(prisma, SETTING_BRANDING_THEME, sanitizeTheme(theme));
}

export { sanitizeTheme as sanitizeBrandingThemeForTests };
