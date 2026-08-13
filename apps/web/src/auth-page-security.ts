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

/** Security headers for auth pages that ship nonce-gated inline scripts. `trustedOrigins`
 *  (Settings → Security, `csp_trusted_origins`) extends `script-src` alongside the nonce and adds
 *  `connect-src`/`frame-src` for a login challenge widget (e.g. Cloudflare Turnstile); omitted
 *  entirely when empty, so an unconfigured instance gets today's exact header. */
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
      ...(trustedOrigins.length > 0 ? [`connect-src ${trustedOrigins.join(" ")}`] : []),
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
