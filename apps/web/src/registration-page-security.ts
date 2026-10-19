import type { BrandingTheme } from "@admitto/auth";
import { buildTicketFontSrc, buildTicketImgSrc, getTicketPageSecurityHeaders, renderNotFound } from "./ticket-page.js";

/** The only origin the Cloudflare Turnstile widget needs (script and iframe). */
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export interface RegistrationPageSecurityOptions {
  /** True only when the instance has Turnstile keys configured. Without keys the form is closed
   *  (D-C2), so Cloudflare is never added to the policy "just in case". */
  turnstile: boolean;
  theme?: BrandingTheme | null;
  logoUrl?: string | null;
  /** True when the request arrived over HTTPS (see `isSecureRequest`); HSTS is only safe there. */
  secure?: boolean;
}

/** Security headers for the public registration form (`GET /r/:slug`) and its POST answers.
 *
 *  The ticket page headers cannot be reused: they forbid scripts, `fetch` and forms, all of which
 *  the form needs. This policy is nonce-only for scripts (no `unsafe-inline`) and never reads
 *  `csp_trusted_origins`: a superadmin-editable list must not widen the trust of a page that
 *  collects personal data. `Referrer-Policy: same-origin` keeps `Origin` intact for a navigation
 *  POST, which the cross-site guard would otherwise answer with 403. */
export function getRegistrationPageSecurityHeaders(
  scriptNonce: string,
  options: RegistrationPageSecurityOptions,
): Record<string, string> {
  const { turnstile, theme, logoUrl, secure = false } = options;
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Security-Policy": [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      `img-src ${buildTicketImgSrc(logoUrl)}`,
      `font-src ${buildTicketFontSrc(theme)}`,
      `script-src ${["'nonce-" + scriptNonce + "'", ...(turnstile ? [TURNSTILE_ORIGIN] : [])].join(" ")}`,
      "connect-src 'self'",
      ...(turnstile ? [`frame-src ${TURNSTILE_ORIGIN}`] : []),
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join("; "),
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    ...(secure ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
  };
}

/** The one 404 for every registration route that has nothing to show: an unknown slug and a
 *  closed or unconfigured event must be byte for byte the same, so a stranger cannot tell which
 *  slugs exist. It takes no event, no theme and no database, so nothing event-specific can leak
 *  into it. The branding theme is deliberately not loaded (a lookup per probe would also be a
 *  database cost for anyone guessing slugs). */
export function renderRegistrationNotFound(secure: boolean): {
  status: 404;
  headers: Record<string, string>;
  html: string;
} {
  return { status: 404, headers: getTicketPageSecurityHeaders(null, null, secure), html: renderNotFound(null) };
}
