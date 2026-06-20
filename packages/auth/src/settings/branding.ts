import type { PrismaClient, Prisma } from "@prisma/client";
import { getSetting } from "./resolver.js";
import { SETTING_BRANDING_THEME } from "./keys.js";

export interface BrandingTheme {
  primary?: string;
  font_family_url?: string;
  font_family_name?: string;
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** Mirror @admitto/ui sanitizeBrandingFontFamilyName — auth must not depend on @admitto/ui. */
function sanitizeBrandingFontFamilyName(name: string): string | undefined {
  const cleaned = name.trim().replace(/[^A-Za-z0-9 \-_.]/g, "").slice(0, 128);
  return cleaned || undefined;
}

/** Mirror @admitto/ui isSafeBrandingFontUrl — auth must not depend on @admitto/ui. */
function isSafeBrandingFontUrl(url: string): boolean {
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

function sanitizeTheme(raw: unknown): BrandingTheme {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const primary = typeof o.primary === "string" && HEX_RE.test(o.primary) ? o.primary : undefined;
  const font_family_url =
    typeof o.font_family_url === "string" && isSafeBrandingFontUrl(o.font_family_url)
      ? o.font_family_url
      : undefined;
  const font_family_name =
    typeof o.font_family_name === "string"
      ? sanitizeBrandingFontFamilyName(o.font_family_name)
      : undefined;
  return { primary, font_family_url, font_family_name };
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
