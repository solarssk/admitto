const DEFAULT_PRIMARY = "#066fd1";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export interface BrandingThemeInput {
  primary?: string;
  font_family_name?: string;
  font_family_url?: string;
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
  const n = parseInt(hex.slice(1), 16);
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
const FONT_FAMILY_NAME_CHARS_RE = /[^A-Za-z0-9 \-_.]/g;

/** Strip unsafe characters from a CSS font-family name (ticket page / @font-face). */
export function sanitizeBrandingFontFamilyName(name: string): string | undefined {
  const cleaned = name.trim().replace(FONT_FAMILY_NAME_CHARS_RE, "").slice(0, FONT_FAMILY_NAME_MAX);
  return cleaned || undefined;
}

/** True when name is non-empty, within length, and uses the allowed charset only. */
export function isValidBrandingFontFamilyName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > FONT_FAMILY_NAME_MAX) return false;
  return !FONT_FAMILY_NAME_CHARS_RE.test(trimmed);
}

/** HTTPS font URL safe for storage and @font-face (no credentials, max 2048). */
export function isSafeBrandingFontUrl(url: string): boolean {
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

  const fontUrl = input?.font_family_url?.trim();
  const fontName = sanitizeBrandingFontFamilyName(input?.font_family_name ?? "");
  if (fontUrl && fontName && isSafeBrandingFontUrl(fontUrl)) {
    const canonicalUrl = new URL(fontUrl).href;
    vars["--font-sans"] = `"${fontName}", Inter, system-ui, sans-serif`;
    vars.fontFaceCss = `@font-face{font-family:"${fontName}";src:url("${canonicalUrl}") format("woff2"),url("${canonicalUrl}") format("woff");font-display:swap;}`;
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
