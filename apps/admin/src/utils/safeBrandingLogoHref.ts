/** Keep in sync with `BRANDING_UPLOAD_PATH` in `@admitto/mail-templates` escape.ts. */
const BRANDING_UPLOAD_PATH =
  /^\/uploads\/[a-z0-9][a-z0-9_-]{0,63}(\/events\/[a-z0-9][a-z0-9_-]{0,127})?\/[^/]+\.(png|jpe?g|webp)$/i;

/** Return a logo URL safe for img src: HTTPS external or validated local `/uploads/` path. */
export function safeBrandingLogoHref(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/uploads/")) {
    if (trimmed.includes("..") || !BRANDING_UPLOAD_PATH.test(trimmed)) return null;
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}
