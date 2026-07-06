/** Product name for auth HTML (browser tab, password managers, TOTP issuer). */
import { AUTH_PASSWORD_STRENGTH_CSS } from "@admitto/auth/password-strength-script";
import { renderAdmittoFaviconLink } from "./favicon.js";

export const AUTH_PRODUCT_NAME = "Admitto";

export interface AuthDocumentOptions {
  /** Step hint for meta description only — not used as document title. */
  step?: string;
  body: string;
  css?: string;
  /** Optional inline scripts placed just before </body> (no <script> wrapper needed). */
  scripts?: string;
}

/** Inline mark — CSP on auth pages blocks external images; must not use &lt;img src&gt;. Source: packages/ui/src/assets/admitto-mark.svg */
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
  --at-green-600: #279a39;
  --at-gray-400: #94a3b8;
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
.auth-error {
  background: var(--at-red-050);
  color: var(--at-red);
  border-radius: 6px;
  padding: 0.625rem 0.75rem;
  font-size: 0.875rem;
  margin-bottom: 1rem;
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
.auth-sso-fallback {
  background: #fffbeb;
  border: 1px solid #f59f00;
  border-radius: 6px;
  padding: 0.625rem 0.75rem;
  font-size: 0.875rem;
  color: #92400e;
  margin-bottom: 1rem;
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
.auth-mfa-actions .auth-btn-secondary { flex: 1 1 12rem; margin-top: 0; }
.auth-btn-link {
  text-decoration: none;
  text-align: center;
  box-sizing: border-box;
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

/** Google-style icon used on SSO buttons (login page + admin preview). */
export const AUTH_SSO_BUTTON_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 21 21" fill="none" aria-hidden="true"><path d="M20.283 10.356h-8.327v3.451h4.792c-.446 2.193-2.313 3.453-4.792 3.453a5.27 5.27 0 01-5.279-5.28 5.27 5.27 0 015.279-5.279c1.259 0 2.397.447 3.29 1.178l2.6-2.599c-1.584-1.381-3.615-2.233-5.89-2.233a8.908 8.908 0 00-8.934 8.934 8.907 8.907 0 008.934 8.934c4.467 0 8.529-3.249 8.529-8.934 0-.528-.081-1.097-.202-1.625z" fill="#4285F4"/><path d="M1.329 6.817l3.005 2.204a5.268 5.268 0 015.245-3.643c1.259 0 2.397.447 3.29 1.178l2.6-2.599c-1.584-1.381-3.615-2.233-5.89-2.233-3.199 0-5.956 1.681-7.25 4.093z" fill="#EA4335"/><path d="M9.579 19.73c2.213 0 4.22-.725 5.779-1.96l-2.67-2.259a5.274 5.274 0 01-3.109.974 5.27 5.27 0 01-4.979-3.59L1.58 15.116c1.278 2.435 4.042 4.614 7.999 4.614z" fill="#34A853"/><path d="M20.283 10.356h-8.327v3.451h4.792c-.21 1.102-.87 2.064-1.822 2.72l2.67 2.258c1.556-1.439 2.687-3.673 2.687-8.429z" fill="#FBBC05"/></svg>`;

export function authFormSubmitScript(scriptNonce: string): string {
  return `<script nonce="${scriptNonce}">
(function () {
  document.querySelectorAll(".auth-page form").forEach(function (form) {
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

export function renderAuthDocument(options: AuthDocumentOptions): string {
  const { step, body, css = AUTH_PAGE_CSS, scripts } = options;
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const description = step
    ? `${AUTH_PRODUCT_NAME} staff portal — ${step}`
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
  <title>${esc(AUTH_PRODUCT_NAME)}${step ? ` — ${esc(step)}` : ""}</title>
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

/** Centered auth shell — brand lives inside the card (design: ui_kits/admin/LoginScreen.jsx). */
export function renderAuthPage(cardInner: string, wide = false): string {
  const cardClass = wide ? "auth-card auth-card-wide" : "auth-card";
  return `<div class="auth-page"><div class="${cardClass}">${cardInner}</div></div>`;
}
