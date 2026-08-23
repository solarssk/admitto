import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { AUTH_PAGE_ICON_CSP } from "./favicon.js";

/** Per-response nonce for trusted inline scripts on auth HTML pages. */
export function createAuthPageScriptNonce(): string {
  return randomBytes(16).toString("base64");
}

/** Apply the security headers used by a nonce-protected auth HTML response. */
export function applyAuthPageSecurityHeaders(c: Context, headers: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(headers)) {
    c.header(name, value);
  }
}

/** Security headers for auth pages that ship nonce-gated inline scripts. `connect-src 'self'`
 *  is always present so same-origin requests (e.g. Cloudflare's own edge-injected
 *  `/cdn-cgi/challenge-platform` bot-detection beacon, or the MFA-verify page's own WebAuthn
 *  `fetch()` calls) aren't blocked by the `default-src 'none'` fallback on an unconfigured
 *  instance. `trustedOrigins` (Settings → Security, `csp_trusted_origins`) extends `script-src`
 *  alongside the nonce and adds those origins to `connect-src` and `frame-src` for a login
 *  challenge widget (e.g. Cloudflare Turnstile). */
export function getAuthPageInlineScriptHeaders(
  scriptNonce: string,
  trustedOrigins: readonly string[] = [],
): Record<string, string> {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Security-Policy": [
      "default-src 'none'",
      AUTH_PAGE_ICON_CSP,
      "style-src 'unsafe-inline'",
      `script-src ${["'nonce-" + scriptNonce + "'", ...trustedOrigins].join(" ")}`,
      `connect-src ${["'self'", ...trustedOrigins].join(" ")}`,
      ...(trustedOrigins.length > 0 ? [`frame-src ${trustedOrigins.join(" ")}`] : []),
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join("; "),
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  };
}
