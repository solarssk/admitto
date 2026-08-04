import { randomBytes } from "node:crypto";
import { AUTH_PAGE_ICON_CSP } from "./favicon.js";

/** Per-response nonce for trusted inline scripts on auth HTML pages. */
export function createAuthPageScriptNonce(): string {
  return randomBytes(16).toString("base64");
}

/** Security headers for auth pages that ship nonce-gated inline scripts. */
export function getAuthPageInlineScriptHeaders(scriptNonce: string): Record<string, string> {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Security-Policy": [
      "default-src 'none'",
      AUTH_PAGE_ICON_CSP,
      // 'self' for Tabler icons webfont CSS (/vendor/tabler-icons/*); unsafe-inline for AUTH_PAGE_CSS.
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      `script-src 'nonce-${scriptNonce}'`,
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join("; "),
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  };
}
