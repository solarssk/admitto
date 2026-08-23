/** Product name for auth HTML (browser tab, password managers, TOTP issuer). */
import { AUTH_PASSWORD_STRENGTH_CSS } from "@admitto/auth/password-strength-script";
import { renderAdmittoFaviconLink } from "./favicon.js";

export const AUTH_PRODUCT_NAME = "Admitto";

export interface AuthDocumentOptions {
  /** Step hint for meta description only, not used as document title. */
  step?: string;
  body: string;
  css?: string;
  /** Optional inline scripts placed just before </body> (no <script> wrapper needed). */
  scripts?: string;
}

/** Inline mark, CSP on auth pages blocks external images; must not use &lt;img src&gt;. Source: packages/ui/src/assets/admitto-mark.svg */
export const ADMITTO_MARK_SVG = `<svg class="auth-brand-logo" xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="7.5" fill="#066fd1"/><path d="M9.5 16.5l4.2 4.2 7.5-9" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="22.5" y="6" width="4" height="4" rx="1" fill="#ffffff" fill-opacity="0.55"/></svg>`;

export const AUTH_PAGE_CSS = `
:root {
  --at-blue: #066fd1;
  --at-blue-600: #0560b8;
  --at-gray-100: #f1f5f9;
  --at-gray-200: #e2e8f0;
  --at-gray-500: #64748b;
  --at-gray-600: #475569;
  --at-ink: #1d273b;
  --at-red: #d63939;
  --at-red-050: #fbeaea;
  --at-yellow: #f59f00;
  --at-yellow-700: #9a6400;
  --at-yellow-050: #fdf3e1;
  --at-green: #2fb344;
  --at-green-050: #eaf7ec;
  --at-green-600: #279a39;
  --at-gray-50: #f8fafc;
  --at-gray-400: #94a3b8;
  --at-azure: #4299e1;
  --at-azure-050: #e9f3fb;
  /* Status tokens shared with @admitto/ui Notice (packages/ui colors.css). */
  --border: var(--at-gray-200);
  --surface-sunken: var(--at-gray-50);
  --text-muted: var(--at-gray-500);
  --status-ok: var(--at-green);
  --status-ok-tint: var(--at-green-050);
  --status-ok-fg: #1f7a2e;
  --status-warn: var(--at-yellow);
  --status-warn-tint: var(--at-yellow-050);
  --status-warn-fg: #9a6400;
  --status-error: var(--at-red);
  --status-error-tint: var(--at-red-050);
  --status-error-fg: #b32525;
  --status-info: var(--at-azure);
  --status-info-tint: var(--at-azure-050);
  --status-info-fg: #2b6cb0;
}

*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: Inter, system-ui, sans-serif;
  background: var(--at-gray-100);
  min-height: 100vh;
  margin: 0;
  color: var(--at-ink);
}
.auth-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.5rem 1rem;
}
.auth-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--at-ink);
  margin-bottom: 1.375rem;
}
.auth-brand-logo {
  display: inline-flex;
  flex-shrink: 0;
  line-height: 0;
}
.auth-card {
  background: #ffffff;
  border: 1px solid var(--at-gray-200);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  padding: 2.25rem 2.5rem;
  width: 100%;
  max-width: 480px;
}
.auth-card-wide {
  max-width: 540px;
}
.auth-brand h1.auth-product-name {
  font-size: inherit;
  font-weight: inherit;
  margin: 0;
  line-height: inherit;
}
.auth-page-action {
  font-size: 1.375rem;
  font-weight: 700;
  margin: 0 0 0.25rem;
  text-wrap: balance;
}
.auth-step-indicator {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--at-gray-500);
}
.auth-step-indicator__meta {
  font-weight: 600;
  color: var(--at-blue);
}
.auth-card .subtitle {
  font-size: 0.875rem;
  color: var(--at-gray-500);
  margin: 0 0 1.375rem;
  text-wrap: pretty;
}
/* Notice subset, same classes/structure as packages/ui Notice (SSR auth cannot import React).
   margin-bottom replaces the SPA parent flex-gap that normally spaces Notice from siblings. */
.at-notice {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  width: 100%;
  box-sizing: border-box;
  margin: 0 0 1rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 0.8125rem;
}
.at-notice__icon {
  margin-top: 1px;
  flex: none;
  display: block;
}
.at-notice__body { flex: 1; }
.at-notice--info {
  border-color: var(--border);
  background: var(--surface-sunken);
  color: var(--text-muted);
}
.at-notice--highlight {
  border-color: var(--status-info);
  background: var(--status-info-tint);
  color: var(--status-info-fg);
}
.at-notice--success {
  border-color: var(--status-ok);
  background: var(--status-ok-tint);
  color: var(--status-ok-fg);
}
.at-notice--warning {
  border-color: var(--status-warn);
  background: var(--status-warn-tint);
  color: var(--status-warn-fg);
}
.at-notice--error {
  border-color: var(--status-error);
  background: var(--status-error-tint);
  color: var(--status-error-fg);
}
.auth-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--at-ink);
  margin-bottom: 0.375rem;
}
.auth-input {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--at-gray-200);
  border-radius: 6px;
  font-size: 0.875rem;
  color: var(--at-ink);
  outline: none;
  transition: border-color 0.15s;
}
.auth-input:focus { border-color: var(--at-blue); box-shadow: 0 0 0 3px rgba(6,111,209,0.15); }
.auth-field { margin-bottom: 1rem; }
.auth-label-optional {
  font-weight: 400;
  color: var(--at-gray-500);
}
.auth-field-hint {
  margin: 0.375rem 0 0;
  font-size: 0.8125rem;
  color: var(--at-gray-500);
}
.auth-otp-wrap { margin-bottom: 1rem; }
/* Matches the already-centered digit boxes below it - left-aligned otherwise, since .auth-label
   is shared with every other (left-aligned, single-line) field on these auth pages. */
.auth-otp-wrap > .auth-label { text-align: center; }
/* Space from Continue above, matching the gap Continue itself keeps from the field above it -
   otherwise sits directly against it with no gap at all. .at-notice's own margin is bottom-only
   (spaces it from what follows, not what precedes it), so the wrapper needs its own top margin
   for when the notice is visible between Continue and the button. */
#mfa-webauthn-btn, .auth-webauthn-error { margin-top: 0.75rem; }
.auth-otp-digits {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  margin: 0.75rem 0 0;
}
.auth-otp-digit {
  width: 2.75rem;
  height: 3rem;
  padding: 0;
  text-align: center;
  font-size: 1.375rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
  color: var(--at-ink);
  border: 1px solid var(--at-gray-200);
  border-radius: 8px;
  background: #fff;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.auth-otp-digit:focus {
  border-color: var(--at-blue);
  box-shadow: 0 0 0 3px rgba(6,111,209,0.15);
}
/* Narrow phones: 6 digits at the default 2.75rem width + 0.5rem gaps (~19rem) plus the
   card's own side padding no longer fit inside small viewports (e.g. 320-390px) without
   horizontal overflow. Shrink the card's side padding and the digit boxes so the row
   always fits within the viewport instead of scrolling. */
@media (max-width: 480px) {
  .auth-card {
    padding: 1.75rem 1.25rem;
  }
  .auth-otp-digits {
    gap: 0.3125rem;
  }
  .auth-otp-digit {
    width: 2.25rem;
    height: 2.625rem;
    font-size: 1.125rem;
  }
}
.auth-otp-backup-toggle {
  display: block;
  width: 100%;
  margin: 1rem 0 0;
  padding: 0;
  background: none;
  border: none;
  color: var(--at-blue);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.auth-otp-backup-toggle:hover { color: var(--at-blue-600); }
.auth-otp-backup-panel { margin-top: 0.75rem; }
.auth-btn-primary {
  display: block;
  width: 100%;
  min-height: 42px;
  padding: 0.625rem 1rem;
  background: var(--at-blue);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  margin-top: 1.25rem;
  transition: background 0.15s;
}
.auth-btn-primary:hover { background: var(--at-blue-600); }
.auth-btn-secondary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  width: 100%;
  min-height: 42px;
  padding: 0.625rem 1rem;
  background: #fff;
  color: var(--at-ink);
  border: 1px solid var(--at-gray-200);
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  text-decoration: none;
  transition: background 0.15s;
}
.auth-btn-secondary:hover { background: var(--at-gray-100); }
.auth-btn-sso { margin-bottom: 0; }
.auth-sso-list { display: flex; flex-direction: column; gap: 0.5rem; }
.auth-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 1.125rem 0;
  font-size: 0.75rem;
  color: var(--at-gray-500);
}
.auth-divider::before, .auth-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--at-gray-200);
}
.auth-footer {
  font-size: 0.75rem;
  color: var(--at-gray-500);
  text-align: center;
  margin-top: 1.25rem;
  line-height: 1.5;
}
.auth-check-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--at-gray-500);
  margin-top: 0.75rem;
}
.auth-backup {
  background: var(--at-yellow-050);
  border: 1px solid #f59f00;
  border-radius: 6px;
  padding: 0.75rem;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}
.auth-backup ul {
  margin: 0.5rem 0;
  padding-left: 1.25rem;
}
.auth-backup code {
  font-size: 0.8rem;
}
.auth-backup-muted {
  background: var(--at-gray-100);
  border-color: var(--at-gray-200);
}
.auth-uri-code {
  font-size: 0.75rem;
  word-break: break-all;
  display: block;
  background: var(--at-gray-100);
  padding: 0.5rem;
  border-radius: 4px;
}
.auth-muted {
  font-size: 0.875rem;
  color: var(--at-gray-500);
  margin: 0 0 1rem;
  text-wrap: pretty;
}
.auth-mfa-setup { margin-bottom: 1.25rem; }
.auth-mfa-setup-hint { margin-top: 0; }
.auth-qr-wrap { display: flex; justify-content: center; margin: 0 0 1rem; }
.auth-qr {
  border: 1px solid var(--at-gray-200);
  border-radius: 8px;
  background: #fff;
}
.auth-secret-input {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  letter-spacing: 0.04em;
}
.auth-mfa-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
/* Enrollment method choice: a form (Authenticator app) alongside two plain links (Passkey,
   Security key) styled as buttons - one gap value for the whole stack instead of relying on
   each child's own margin, which would double up with flex gap. */
.auth-enroll-method-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1.25rem;
}
.auth-enroll-method-list .auth-btn-primary {
  margin-top: 0;
}
.auth-enroll-method-list .auth-btn-secondary {
  text-decoration: none;
}
/* "Choose a different method" link, shown on both the QR (TOTP) and WebAuthn enrollment steps
   when reached via the method-choice page - same glued-to-the-form/button-above-it gap
   .auth-btn-secondary already needed fixing for elsewhere on this page family (#mfa-webauthn-btn),
   shared by both step pages instead of a fragile per-page ID sibling selector. */
.auth-enroll-back-link {
  margin-top: 0.75rem;
}
.auth-mfa-actions .auth-btn-secondary { flex: 1 1 12rem; margin-top: 0; }
.auth-btn-link {
  text-decoration: none;
  text-align: center;
  box-sizing: border-box;
}
.auth-mfa-desktop-hint { margin-top: 0.25rem; margin-bottom: 0.75rem; }
.auth-mfa-mobile-only { display: none; }
@media (hover: none) and (pointer: coarse) {
  .auth-mfa-mobile-only { display: contents; }
  .auth-mfa-desktop-hint { display: none; }
}
.auth-otpauth-details { margin-bottom: 1rem; }
.auth-otpauth-details summary {
  cursor: pointer;
  color: var(--at-gray-500);
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
}
${AUTH_PASSWORD_STRENGTH_CSS}
`;

/**
 * Generic SSO icon for /login provider buttons, a neutral shield glyph (same mark
 * used for OIDC providers in the admin identity list), not a specific vendor's logo.
 * The button's own label text (configurable per provider) is what identifies the
 * actual provider; the icon just marks "this is a single sign-on button".
 */
export const AUTH_SSO_BUTTON_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3" /><path d="M11 11a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M12 12l0 2.5" /></svg>`;

export function authFormSubmitScript(scriptNonce: string): string {
  return `<script nonce="${scriptNonce}">
(function () {
  document.querySelectorAll(".auth-page form").forEach(function (form) {
    if (form.dataset.authNoSubmitLock === "true") return;
    form.addEventListener("submit", function () {
      var btn = form.querySelector('button[type="submit"]');
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      if (!btn.dataset.originalLabel) btn.dataset.originalLabel = btn.textContent || "";
      btn.textContent = btn.dataset.loadingLabel || "Please wait…";
    });
  });
})();
</script>`;
}

/**
 * Capture the browser's IANA timezone into a hidden `timezone` form field on submit.
 * When `ssoLinks` is true, also rewrite `.auth-btn-sso` hrefs with `?tz=` (login page).
 * HTML form POSTs have no X-Client-Timezone header; missing JS leaves the field empty → null.
 */
export function authTimezoneCaptureScript(
  scriptNonce: string,
  options: { ssoLinks?: boolean } = {},
): string {
  const ssoBlock = options.ssoLinks
    ? `
  function appendTz(href) {
    var tz = browserTimezone();
    if (!tz) return href;
    try {
      var url = new URL(href, window.location.origin);
      url.searchParams.set("tz", tz);
      return url.pathname + url.search;
    } catch (e) {
      return href;
    }
  }
  document.querySelectorAll("a.auth-btn-sso").forEach(function (a) {
    a.addEventListener("click", function () {
      a.setAttribute("href", appendTz(a.getAttribute("href") || a.href));
    });
  });`
    : "";
  return `<script nonce="${scriptNonce}">
(function () {
  function browserTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (e) {
      return "";
    }
  }
  document.querySelectorAll(".auth-page form").forEach(function (form) {
    form.addEventListener("submit", function () {
      var input = form.querySelector('input[name="timezone"]');
      if (input) input.value = browserTimezone();
    });
  });${ssoBlock}
})();
</script>`;
}

export function renderAuthDocument(options: AuthDocumentOptions): string {
  const { step, body, css = AUTH_PAGE_CSS, scripts } = options;
  const esc = (s: string) =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const description = step
    ? `${AUTH_PRODUCT_NAME} staff portal - ${step}`
    : `${AUTH_PRODUCT_NAME} staff portal`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="application-name" content="${esc(AUTH_PRODUCT_NAME)}">
  <meta name="apple-mobile-web-app-title" content="${esc(AUTH_PRODUCT_NAME)}">
  <meta property="og:site_name" content="${esc(AUTH_PRODUCT_NAME)}">
  <meta name="description" content="${esc(description)}">
  ${renderAdmittoFaviconLink()}
  <title>${esc(AUTH_PRODUCT_NAME)}${step ? ` - ${esc(step)}` : ""}</title>
  <style>${css}</style>
</head>
<body>
${body}${scripts ? `\n${scripts}` : ""}
</body>
</html>`;
}

export function renderAuthBrand(): string {
  return `<div class="auth-brand">${ADMITTO_MARK_SVG}<h1 class="auth-product-name">${AUTH_PRODUCT_NAME}</h1></div>`;
}

/** Centered auth shell, brand lives inside the card (design: ui_kits/admin/LoginScreen.jsx). */
export function renderAuthPage(cardInner: string, wide = false): string {
  const cardClass = wide ? "auth-card auth-card-wide" : "auth-card";
  return `<div class="auth-page"><div class="${cardClass}">${cardInner}</div></div>`;
}
