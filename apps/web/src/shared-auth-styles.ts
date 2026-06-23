/** Product name for auth HTML (browser tab, password managers, TOTP issuer). */
import { renderAdmittoFaviconLink } from "./favicon.js";
import { TABLER_ICONS_CSS_PATH } from "./vendor-assets.js";

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
  --at-ink: #1d273b;
  --at-red: #d63939;
  --at-red-050: #fbeaea;
  --at-yellow-050: #fdf3e1;
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
`;

export const ADMIN_PAGE_CSS = `
:root {
  --at-blue: #066fd1;
  --at-blue-dark: #0558a5;
  --at-gray-050: #f8fafc;
  --at-gray-100: #f1f5f9;
  --at-gray-200: #e2e8f0;
  --at-gray-500: #64748b;
  --at-gray-700: #334155;
  --at-ink: #1d273b;
  --at-red: #d63939;
  --at-red-050: #fbeaea;
  --at-green-050: #e9f7ec;
  --at-sidebar-w: 220px;
  --at-topbar-h: 52px;
  --at-radius: 6px;
}

*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0; padding: 0;
  height: 100%;
  overflow: hidden;
}

body {
  font-family: Inter, system-ui, sans-serif;
  color: var(--at-ink);
  background: var(--at-gray-100);
  display: grid;
  grid-template-columns: var(--at-sidebar-w) 1fr;
  grid-template-rows: 100vh;
}

/* ---------- sidebar ---------- */
.adm-sidebar {
  grid-row: 1;
  grid-column: 1;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid var(--at-gray-200);
  overflow-y: auto;
  padding: 0 8px 16px;
}

.adm-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 8px 12px;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--at-ink);
  text-decoration: none;
}

.adm-brand svg {
  flex-shrink: 0;
}

.adm-overline {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--at-gray-500);
  padding: 12px 8px 4px;
}

.adm-nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }

.adm-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--at-radius);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--at-gray-700);
  text-decoration: none;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.adm-nav-item i { font-size: 17px; color: var(--at-gray-500); }

.adm-nav-item:hover { background: var(--at-gray-100); color: var(--at-ink); }
.adm-nav-item:hover i { color: var(--at-ink); }

.adm-nav-item--active {
  background: #e8f2fc;
  color: var(--at-blue);
}
.adm-nav-item--active i { color: var(--at-blue); }

.adm-nav-item--sub { padding-left: 14px; font-size: 0.8125rem; }

.adm-foot {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--at-gray-200);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* ---------- main ---------- */
.adm-main {
  grid-row: 1;
  grid-column: 2;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  min-height: 0;
}

.adm-topbar {
  flex: none;
  height: var(--at-topbar-h);
  display: flex;
  align-items: center;
  padding: 0 24px;
  background: #fff;
  border-bottom: 1px solid var(--at-gray-200);
  font-weight: 600;
  font-size: 0.9375rem;
  gap: 12px;
  position: sticky;
  top: 0;
  z-index: 10;
}

.adm-topbar__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--at-gray-500);
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 400;
  margin-right: auto;
}

.adm-topbar__back:hover { color: var(--at-ink); }

.adm-content {
  padding: 28px 32px;
  max-width: 800px;
}

h1 { font-size: 1.25rem; font-weight: 700; margin: 0 0 1.25rem; color: var(--at-ink); }
.admin-nav { margin-bottom: 1rem; font-size: 0.875rem; }
.admin-nav a { color: var(--at-blue); }
label { display: block; margin-top: 0.75rem; font-size: 0.875rem; }
input[type=text], input[type=password], input[type=url], select {
  width: 100%;
  padding: 0.4rem 0.5rem;
  margin-top: 0.25rem;
  border: 1px solid var(--at-gray-200);
  border-radius: var(--at-radius);
  font-size: 0.875rem;
  background: #fff;
}
input[type=text]:focus, input[type=password]:focus, input[type=url]:focus, select:focus {
  outline: 2px solid var(--at-blue);
  outline-offset: 1px;
}
fieldset { margin-top: 1rem; border: 1px solid var(--at-gray-200); padding: 0.75rem; border-radius: var(--at-radius); }
legend { font-size: 0.8125rem; font-weight: 600; color: var(--at-gray-700); }
table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
th, td { border: 1px solid var(--at-gray-200); padding: 0.5rem 0.625rem; text-align: left; font-size: 0.875rem; }
th { background: var(--at-gray-050); font-weight: 600; }
td input, td select { width: 100%; margin-top: 0; }
.error { color: var(--at-red); background: var(--at-red-050); padding: 0.5rem 0.75rem; border-radius: var(--at-radius); margin-bottom: 0.75rem; font-size: 0.875rem; }
.flash { color: #065f46; background: #d1fae5; padding: 0.5rem 0.75rem; border-radius: var(--at-radius); margin-bottom: 0.75rem; font-size: 0.875rem; }
.muted { color: var(--at-gray-500); font-size: 0.8125rem; }
button, .toggle-btn {
  margin-top: 1rem;
  margin-right: 0.5rem;
  padding: 0.45rem 1rem;
  border: 1px solid var(--at-gray-200);
  border-radius: var(--at-radius);
  background: #fff;
  font-family: Inter, system-ui, sans-serif;
  font-size: 0.875rem;
  cursor: pointer;
  color: var(--at-ink);
}
button[type=submit]:not(.toggle-btn) { background: var(--at-blue); color: #fff; border-color: var(--at-blue); }
button[type=submit]:not(.toggle-btn):hover { background: var(--at-blue-dark); border-color: var(--at-blue-dark); }
.toggle-btn { margin-top: 0; }
.warn-block { background: #fff8e1; border: 1px solid #f59f00; border-radius: var(--at-radius); padding: 0.75rem; margin: 0.75rem 0; font-size: 0.875rem; }
.info-block { background: #e9f2fc; border: 1px solid #066fd1; border-radius: var(--at-radius); padding: 0.75rem; margin: 0.75rem 0; font-size: 0.875rem; }
.badge-ok { display: inline-block; background: var(--at-green-050); color: #1f7a2e; border-radius: 4px; padding: 2px 8px; font-size: 0.8125rem; }
.badge-neutral { display: inline-block; background: var(--at-gray-100); color: var(--at-gray-500); border-radius: 4px; padding: 2px 8px; font-size: 0.8125rem; }
.status-line { margin: 0 0 1rem; font-size: 0.9rem; display: flex; align-items: center; gap: 8px; }

/* secondary (horizontal) subnav — padding matches SPA .settings-subnav */
.adm-subnav {
  display: flex;
  padding: 0 24px;
  background: #fff;
  border-bottom: 1px solid var(--at-gray-200);
}

.adm-subnav-item {
  display: inline-flex;
  align-items: center;
  padding: 12px 16px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--at-gray-500);
  text-decoration: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.12s, border-color 0.12s;
  white-space: nowrap;
}

.adm-subnav-item:hover { color: var(--at-ink); }

.adm-subnav-item--active {
  color: var(--at-blue);
  border-bottom-color: var(--at-blue);
  font-weight: 600;
}

@media (max-width: 768px) {
  body { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .adm-sidebar { display: none; }
  .adm-main { grid-column: 1; }
  .adm-content { padding: 16px; }
}
`;

const ADMIN_MARK_SVG = `<svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="30" height="30" rx="7.5" fill="#066fd1"/><path d="M9.5 16.5l4.2 4.2 7.5-9" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="22.5" y="6" width="4" height="4" rx="1" fill="#ffffff" fill-opacity="0.55"/></svg>`;

const SETTINGS_SUBNAV_ITEMS = [
  { label: "General", href: "/admin/settings" },
  { label: "Identity providers", href: "/admin/auth/providers" },
  { label: "Cloudflare Access", href: "/admin/auth/cf-access" },
] as const;

export interface AdminShellOptions {
  title: string;
  body: string;
  activeItem?: "providers" | "cf-access" | "settings";
  favicon: string;
}

/** Render a full admin page with sidebar navigation matching the SPA design. */
export function renderAdminShell(options: AdminShellOptions): string {
  const { title, body, activeItem, favicon } = options;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const sidebar = `<aside class="adm-sidebar">
  <a class="adm-brand" href="/admin">${ADMIN_MARK_SVG}<span>Admitto</span></a>
  <nav class="adm-nav" aria-label="Main">
    <a class="adm-nav-item" href="/admin"><i class="ti ti-calendar-event"></i><span>All events</span></a>
  </nav>
  <div class="adm-foot">
    <a class="adm-nav-item adm-nav-item--active" href="/admin/settings"><i class="ti ti-settings"></i><span>Settings</span></a>
  </div>
</aside>`;

  const subnav = SETTINGS_SUBNAV_ITEMS.map((item) => {
    const isActive = (activeItem === "settings" && item.href === "/admin/settings")
      || (activeItem === "providers" && item.href === "/admin/auth/providers")
      || (activeItem === "cf-access" && item.href === "/admin/auth/cf-access");
    return `<a class="adm-subnav-item${isActive ? " adm-subnav-item--active" : ""}" href="${esc(item.href)}">${esc(item.label)}</a>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  ${favicon}
  <title>Admitto — ${esc(title)}</title>
  <link rel="stylesheet" href="${TABLER_ICONS_CSS_PATH}">
  <style>${ADMIN_PAGE_CSS}</style>
</head>
<body>
${sidebar}
<div class="adm-main">
  <header class="adm-topbar">
    <a class="adm-topbar__back" href="/admin"><i class="ti ti-chevron-left"></i>All events</a>
    <span>${esc(title)}</span>
  </header>
  <nav class="adm-subnav" aria-label="Settings sections">${subnav}</nav>
  <div class="adm-content">
    ${body}
  </div>
</div>
</body>
</html>`;
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
  <title>${esc(AUTH_PRODUCT_NAME)}</title>
  <style>${css}</style>
</head>
<body>
${body}${scripts ? `\n${scripts}` : ""}
</body>
</html>`;
}

export function renderAuthBrand(): string {
  return `<header class="auth-brand" role="banner">${ADMITTO_MARK_SVG}<h1 class="auth-product-name">${AUTH_PRODUCT_NAME}</h1></header>`;
}

/** Centered auth shell — brand lives inside the card (design: ui_kits/admin/LoginScreen.jsx). */
export function renderAuthPage(cardInner: string, wide = false): string {
  const cardClass = wide ? "auth-card auth-card-wide" : "auth-card";
  return `<div class="auth-page"><div class="${cardClass}">${cardInner}</div></div>`;
}
