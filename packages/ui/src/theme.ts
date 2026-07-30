const DEFAULT_PRIMARY = "#066fd1";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** One uploaded/linked font file for a specific weight+style — a real family (e.g. "Acme Sans")
 * needs one of these per weight/style combo it actually has, since a browser can only render a
 * true bold/italic from a file declared for that exact combo; anything missing is synthesized
 * (faked, not the real typeface) from whichever variant IS present. */
export interface BrandingFontVariant {
  weight: number;
  style: "normal" | "italic";
  url: string;
}

/** A saved custom font family - a name plus every weight/style file uploaded for it. Kept as a
 * library (not just "the active one") so switching back to a previously-uploaded family doesn't
 * need re-uploading its files. */
export interface BrandingCustomFontFamily {
  name: string;
  variants: BrandingFontVariant[];
}

export interface BrandingThemeInput {
  primary?: string;
  /** The active pick for the admin staff SPA - either a built-in name (e.g. "Manrope") or one of
   * custom_font_families[].name. */
  font_family_name?: string;
  /** The active pick for the public ticket page - same rules as font_family_name, falls back to
   * it when unset so a single global font remains the default until someone overrides it. */
  ticket_font_family_name?: string;
  custom_font_families?: BrandingCustomFontFamily[];
}

export interface ResolvedThemeVars {
  "--primary": string;
  "--primary-hover": string;
  "--primary-active": string;
  "--primary-tint": string;
  "--font-sans"?: string;
  fontFaceCss?: string;
}

function clampChannel(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  if (!HEX_RE.test(hex)) return null;
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mix(hex: string, amount: number, towardWhite: boolean): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const mixWith = towardWhite ? 255 : 0;
  const r = clampChannel(rgb.r + (mixWith - rgb.r) * amount);
  const g = clampChannel(rgb.g + (mixWith - rgb.g) * amount);
  const b = clampChannel(rgb.b + (mixWith - rgb.b) * amount);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const FONT_FAMILY_NAME_MAX = 128;
const FONT_FAMILY_NAME_REPLACE_RE = /[^A-Za-z0-9 \-_.]/g;
const FONT_FAMILY_NAME_TEST_RE = /[^A-Za-z0-9 \-_.]/;

/** Strip unsafe characters from a CSS font-family name (ticket page / @font-face). */
export function sanitizeBrandingFontFamilyName(name: string): string | undefined {
  const cleaned = name.trim().replace(FONT_FAMILY_NAME_REPLACE_RE, "").slice(0, FONT_FAMILY_NAME_MAX);
  return cleaned || undefined;
}

/** True when name is non-empty, within length, and uses the allowed charset only. */
export function isValidBrandingFontFamilyName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > FONT_FAMILY_NAME_MAX) return false;
  return !FONT_FAMILY_NAME_TEST_RE.test(trimmed);
}

// Mirrors apps/admin/src/utils/safeBrandingLogoHref.ts's BRANDING_UPLOAD_PATH pattern, scoped to
// this feature's own uploads/{orgId}/theme/{file} storage path and font extensions. The filename
// stem is restricted to a safe charset (not just "no slash") as the primary defense - this path
// (unlike the PUT /api/staff/theme endpoint it validates for) is never required to be
// server-generated, so it can't just rely on every upload having gone through the honest upload
// flow first. fontFaceRuleFor below also escapes the URL before interpolating it into CSS, as a
// second, independent layer rather than trusting this regex alone.
const BRANDING_FONT_UPLOAD_PATH = /^\/uploads\/[a-z0-9][a-z0-9_-]{0,63}\/theme\/[a-z0-9_-]+\.(woff2?|ttf|otf)$/i;

/** True for a validated local `/uploads/.../theme/` upload path (no `..`, matches the pattern). */
export function isLocalBrandingFontPath(url: string): boolean {
  return url.startsWith("/uploads/") && !url.includes("..") && BRANDING_FONT_UPLOAD_PATH.test(url);
}

/** Font URL safe for storage and @font-face: an uploaded local `/uploads/.../theme/` path, or an
 * external HTTPS URL (no credentials, max 2048 chars). */
export function isSafeBrandingFontUrl(url: string): boolean {
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

/** True for a usable CSS font-weight (100-900 per the CSS spec's numeric keyword range). */
export function isValidBrandingFontWeight(weight: number): boolean {
  return Number.isInteger(weight) && weight >= 100 && weight <= 900;
}

/** Names of the self-hosted built-in fonts (see packages/ui/src/styles/tokens/fonts.css) - a
 * custom family can't be saved under one of these. Both a built-in pick and a custom family write
 * the same font_family_name string, so a same-named custom family would make the built-in
 * unreachable (every reader of that string, including the admin picker and resolveThemeVars
 * above, would always resolve to the custom one instead). */
export const BUILT_IN_FONT_FAMILY_NAMES = ["Manrope", "Space Grotesk", "IBM Plex Sans"] as const;

/** The label the picker shows for "no custom font" (Admitto's own default, Inter under
 * `--font-sans`). Reserved for the same reason as the built-ins above, and given the identical
 * resolution as an unset font_family_name (see resolveThemeVars) - this lets a surface be pinned
 * to it explicitly, decoupled from another surface's own current pick, without a second sentinel
 * alongside `undefined`. */
export const DEFAULT_BRANDING_FONT_FAMILY_NAME = "Admitto Sans";

/** True when name is the reserved default label, case-insensitively - distinct from the other
 * built-ins below, since (unlike them) it means "no override at all" rather than a real font. */
export function isDefaultBrandingFontFamilyName(name: string): boolean {
  return name.trim().toLowerCase() === DEFAULT_BRANDING_FONT_FAMILY_NAME.toLowerCase();
}

/** True when name matches a built-in font name or the reserved default label, case-insensitively. */
export function isReservedBrandingFontFamilyName(name: string): boolean {
  if (isDefaultBrandingFontFamilyName(name)) return true;
  const trimmed = name.trim().toLowerCase();
  return BUILT_IN_FONT_FAMILY_NAMES.some((n) => n.toLowerCase() === trimmed);
}

const FONT_FORMAT_BY_EXT: Record<string, string> = {
  woff2: "woff2",
  woff: "woff",
  ttf: "truetype",
  otf: "opentype",
};

/** CSS `format()` hint from a font URL's extension - browsers mostly sniff the bytes directly
 * regardless, but a correct hint is still the honest thing to declare. */
function fontFormat(url: string): string | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(url);
  return match ? FONT_FORMAT_BY_EXT[match[1].toLowerCase()] : undefined;
}

/** Escape `\` and `"` for safe interpolation into a double-quoted CSS string - defense in depth
 * alongside the URL charset validation above, not a substitute for it. */
function escapeCssString(value: string): string {
  return value.replaceAll("\\", String.raw`\\`).replaceAll('"', String.raw`\"`);
}

function fontFaceRuleFor(familyName: string, variant: BrandingFontVariant): string {
  const canonicalUrl = isLocalBrandingFontPath(variant.url) ? variant.url : new URL(variant.url).href;
  const safeUrl = escapeCssString(canonicalUrl);
  const format = fontFormat(canonicalUrl);
  const src = format ? `url("${safeUrl}") format("${format}")` : `url("${safeUrl}")`;
  return `@font-face{font-family:"${familyName}";src:${src};font-weight:${variant.weight};font-style:${variant.style};font-display:swap;}`;
}

/** Resolve theme with anti-lockout fallback to Tabler defaults. */
export function resolveThemeVars(input?: BrandingThemeInput | null): ResolvedThemeVars {
  const primary = input?.primary && HEX_RE.test(input.primary) ? input.primary : DEFAULT_PRIMARY;
  const tintRgb = parseHex(primary);
  const tint =
    tintRgb != null
      ? `rgba(${tintRgb.r}, ${tintRgb.g}, ${tintRgb.b}, 0.12)`
      : "var(--primary-tint, #e9f2fc)";

  const vars: ResolvedThemeVars = {
    "--primary": primary,
    "--primary-hover": mix(primary, 0.12, false),
    "--primary-active": mix(primary, 0.22, false),
    "--primary-tint": tint,
  };

  // A name alone (matching no saved custom family) selects a built-in font that's either
  // self-hosted via @fontsource or already installed on the reader's system - no @font-face
  // needed here either way, just the CSS font-family stack below. A name that DOES match a saved
  // custom family additionally needs one @font-face per weight/style it has (a browser can only
  // render a true bold/italic from a file declared for that exact combo - anything missing is
  // synthesized from whichever variant is present, not the real typeface). The reserved default
  // label resolves exactly like an unset name (no override at all) rather than a literal
  // `font-family: "Admitto Sans"` - it's a persisted "explicitly the default" marker, not a real
  // loadable font.
  const rawFontFamilyName = input?.font_family_name;
  const fontName =
    rawFontFamilyName && !isDefaultBrandingFontFamilyName(rawFontFamilyName)
      ? sanitizeBrandingFontFamilyName(rawFontFamilyName)
      : undefined;
  if (fontName) {
    vars["--font-sans"] = `"${fontName}", Inter, system-ui, sans-serif`;
    const activeFamily = input?.custom_font_families?.find((f) => f.name === fontName);
    const variants = (activeFamily?.variants ?? []).filter(
      (v) => isValidBrandingFontWeight(v.weight) && (v.style === "normal" || v.style === "italic") && isSafeBrandingFontUrl(v.url),
    );
    if (variants.length > 0) {
      vars.fontFaceCss = variants.map((v) => fontFaceRuleFor(fontName, v)).join("");
    }
  }

  return vars;
}

/** Serialize resolved theme vars (and optional @font-face) into a CSS style block. */
export function themeVarsToStyleBlock(vars: ResolvedThemeVars): string {
  const { fontFaceCss, ...cssVars } = vars;
  const lines = Object.entries(cssVars)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `  ${k}: ${v};`);
  const root = `:root {\n${lines.join("\n")}\n}`;
  return fontFaceCss ? `${fontFaceCss}\n${root}` : root;
}

/** Inject or update theme style element in document (SPA). */
export function applyThemeVars(input?: BrandingThemeInput | null, doc: Document = document): void {
  const vars = resolveThemeVars(input);
  const css = themeVarsToStyleBlock(vars);
  let el = doc.getElementById("admitto-theme");
  if (!el) {
    el = doc.createElement("style");
    el.id = "admitto-theme";
    doc.head.appendChild(el);
  }
  el.textContent = css;
}
