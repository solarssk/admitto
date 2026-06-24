import {
  AUTH_FORM_SUBMIT_SCRIPT,
  AUTH_PAGE_CSS,
  renderAuthBrand,
  renderAuthDocument,
  renderAuthPage,
} from "./shared-auth-styles.js";
import { AUTH_PAGE_ICON_CSP } from "./favicon.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Security headers for server-rendered operator login and landing pages. */
export function getLoginPageSecurityHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Security-Policy":
      `default-src 'none'; ${AUTH_PAGE_ICON_CSP}; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'`,
    // Primary CSRF signal for HTML form POSTs: Referer on same-origin submits (Safari).
    // Sec-Fetch-Site in same-origin-post.ts is a legacy-UA fallback only.
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  };
}

/** SSO provider link for login footer. */
export interface LoginSsoProvider {
  id: string;
  button_label: string;
}

/** Uniform login failure copy (POST /login). */
export const LOGIN_ERROR_CODE = "invalid_credentials";

function loginErrorMessage(error?: string): string | undefined {
  if (!error) return undefined;
  if (error === LOGIN_ERROR_CODE) {
    return "Invalid email or password.";
  }
  return undefined;
}

const SSO_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 21 21" fill="none" aria-hidden="true"><path d="M20.283 10.356h-8.327v3.451h4.792c-.446 2.193-2.313 3.453-4.792 3.453a5.27 5.27 0 01-5.279-5.28 5.27 5.27 0 015.279-5.279c1.259 0 2.397.447 3.29 1.178l2.6-2.599c-1.584-1.381-3.615-2.233-5.89-2.233a8.908 8.908 0 00-8.934 8.934 8.907 8.907 0 008.934 8.934c4.467 0 8.529-3.249 8.529-8.934 0-.528-.081-1.097-.202-1.625z" fill="#4285F4"/><path d="M1.329 6.817l3.005 2.204a5.268 5.268 0 015.245-3.643c1.259 0 2.397.447 3.29 1.178l2.6-2.599c-1.584-1.381-3.615-2.233-5.89-2.233-3.199 0-5.956 1.681-7.25 4.093z" fill="#EA4335"/><path d="M9.579 19.73c2.213 0 4.22-.725 5.779-1.96l-2.67-2.259a5.274 5.274 0 01-3.109.974 5.27 5.27 0 01-4.979-3.59L1.58 15.116c1.278 2.435 4.042 4.614 7.999 4.614z" fill="#34A853"/><path d="M20.283 10.356h-8.327v3.451h4.792c-.21 1.102-.87 2.064-1.822 2.72l2.67 2.258c1.556-1.439 2.687-3.673 2.687-8.429z" fill="#FBBC05"/></svg>`;

function renderSsoBlock(ssoProviders: LoginSsoProvider[], next?: string): string {
  if (ssoProviders.length === 0) return "";
  const buttons = ssoProviders
    .map((p) => {
      const startUrl = `/api/auth/oidc/${encodeURIComponent(p.id)}/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;
      return `<a href="${esc(startUrl)}" class="auth-btn-secondary auth-btn-sso">${SSO_ICON_SVG}${esc(p.button_label)}</a>`;
    })
    .join("");
  return `<div class="auth-sso-list">${buttons}</div><div class="auth-divider">or</div>`;
}

/** Render the operator sign-in form HTML (optional uniform error message). */
export function renderLoginForm(
  error?: string,
  next?: string,
  ssoProviders: LoginSsoProvider[] = [],
): string {
  const ssoFailed = error === "oidc_failed";
  const loginError = !ssoFailed ? loginErrorMessage(error) : undefined;
  const ssoFallbackBlock = ssoFailed
    ? `<div class="auth-sso-fallback" role="alert">SSO unavailable — use your local password below</div>`
    : "";
  const errorBlock = loginError ? `<div class="auth-error" role="alert">${esc(loginError)}</div>` : "";
  const nextField = next ? `<input type="hidden" name="next" value="${esc(next)}">` : "";
  const ssoBlock = renderSsoBlock(ssoProviders, next);

  const card = `${renderAuthBrand()}
    <h2 class="auth-page-action">Sign in</h2>
    <p class="subtitle">Internal event access gateway</p>
    ${ssoFallbackBlock}
    ${errorBlock}
    ${ssoBlock}
    <form method="post" action="/login" aria-label="Admitto sign in">
      ${nextField}
      <div class="auth-field">
        <label class="auth-label" for="email">Email</label>
        <input class="auth-input" id="email" type="email" name="email" placeholder="you@example.com" required autocomplete="username">
      </div>
      <div class="auth-field">
        <label class="auth-label" for="password">Password</label>
        <input class="auth-input" id="password" type="password" name="password" required autocomplete="current-password">
      </div>
      <button class="auth-btn-primary" type="submit">Sign in</button>
    </form>
    <p class="auth-footer">Admitto is an internal tool.<br>Access is managed by your IT administrator.</p>`;

  return renderAuthDocument({
    step: "Sign in",
    body: renderAuthPage(card),
    css: AUTH_PAGE_CSS,
    scripts: AUTH_FORM_SUBMIT_SCRIPT,
  });
}

/** Event row shown on the temporary `/operator` landing page. */
export interface OperatorEventRow {
  title: string;
  slug: string;
}

/** Render the signed-in operator landing page (event list + sign out). */
export function renderOperatorLanding(email: string, events: OperatorEventRow[]): string {
  const eventList =
    events.length === 0
      ? "<p>No events assigned yet. Contact an administrator.</p>"
      : `<ul>${events.map((e) => `<li>${esc(e.title)} <span style="color:#666">(${esc(e.slug)})</span></li>`).join("")}</ul>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Signed in — Admitto</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1rem; color: #111; }
    h1 { font-size: 1.25rem; }
    .meta { color: #555; font-size: 0.9rem; }
    form { margin-top: 1.5rem; }
  </style>
</head>
<body>
  <h1>Signed in</h1>
  <p class="meta">${esc(email)}</p>
  <h2 style="font-size:1rem;margin-top:1.5rem">Your events</h2>
  ${eventList}
  <form method="post" action="/logout"><button type="submit">Sign out</button></form>
</body>
</html>`;
}
