import {
  authFormSubmitScript,
  authTimezoneCaptureScript,
  AUTH_PAGE_CSS,
  AUTH_SSO_BUTTON_ICON_SVG,
  renderAuthBrand,
  renderAuthDocument,
  renderAuthPage,
} from "./shared-auth-styles.js";
import { renderNoticeHtml } from "./auth-notice.js";
import { getAuthPageInlineScriptHeaders } from "./auth-page-security.js";

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Clear browser-remembered form values after page load so password managers like Bitwarden
 * see empty fields and display the full credential dropdown (not just the small icon).
 *
 * Root cause: Chrome/Safari pre-fill login fields from form history on page load. Bitwarden
 * checks `element.value` on focus; a non-empty value causes it to enter "pre-filled" mode
 * where it only shows the small icon button, not the credential list. Clearing with a short
 * delay (after the browser's synchronous autofill but before the user focuses) ensures
 * Bitwarden sees an empty field and shows the full autofill dropdown.
 */
function loginAutofillClearScript(scriptNonce: string): string {
  return `<script nonce="${scriptNonce}">
(function () {
  function clearBrowserPrefill() {
    var e = document.getElementById("email");
    var p = document.getElementById("password");
    if (e) e.value = "";
    if (p) p.value = "";
  }
  // Run after the browser's synchronous form-fill completes
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(clearBrowserPrefill, 0); });
  } else {
    setTimeout(clearBrowserPrefill, 0);
  }
})();
</script>`;
}

/**
 * Security headers for server-rendered operator login pages (nonce-gated submit script).
 * Referrer-Policy same-origin is the primary CSRF signal for HTML form POSTs (Safari);
 * Sec-Fetch-Site in same-origin-post.ts is a legacy-UA fallback only.
 */
export function getLoginPageSecurityHeaders(scriptNonce: string): Record<string, string> {
  return getAuthPageInlineScriptHeaders(scriptNonce);
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

const SSO_ICON_SVG = AUTH_SSO_BUTTON_ICON_SVG;

function renderSsoBlock(ssoProviders: LoginSsoProvider[], next?: string): string {
  if (ssoProviders.length === 0) return "";
  const buttons = ssoProviders
    .map((p) => {
      const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";
      const startUrl = `/api/auth/oidc/${encodeURIComponent(p.id)}/start${nextQuery}`;
      return `<a href="${esc(startUrl)}" class="auth-btn-secondary auth-btn-sso">${SSO_ICON_SVG}${esc(p.button_label)}</a>`;
    })
    .join("");
  return `<div class="auth-sso-list">${buttons}</div><div class="auth-divider">or</div>`;
}

/** Render the operator sign-in form HTML (optional uniform error message). */
export function renderLoginForm(
  scriptNonce: string,
  error?: string,
  next?: string,
  ssoProviders: LoginSsoProvider[] = [],
): string {
  const ssoFailed = error === "oidc_failed";
  const loginError = !ssoFailed ? loginErrorMessage(error) : undefined;
  const ssoFallbackBlock = ssoFailed
    ? renderNoticeHtml({
        variant: "warning",
        role: "alert",
        message: "SSO unavailable. Use your local password below.",
      })
    : "";
  const errorBlock = loginError
    ? renderNoticeHtml({ variant: "error", role: "alert", message: loginError })
    : "";
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
      <input type="hidden" name="timezone" value="" autocomplete="off">
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
    scripts: `${authFormSubmitScript(scriptNonce)}\n${authTimezoneCaptureScript(scriptNonce, { ssoLinks: true })}\n${loginAutofillClearScript(scriptNonce)}`,
  });
}

/** Event row shown on the temporary `/operator` landing page. */
export interface OperatorEventRow {
  title: string;
  slug: string;
}

/** Render the signed-in operator landing page (event list + sign out). */
export function renderOperatorLanding(email: string, events: OperatorEventRow[]): string {
  const renderEventRow = (e: OperatorEventRow): string =>
    `<li>${esc(e.title)} <span style="color:#666">(${esc(e.slug)})</span></li>`;
  const eventList =
    events.length === 0
      ? "<p>No events assigned yet. Contact an administrator.</p>"
      : `<ul>${events.map(renderEventRow).join("")}</ul>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Signed in - Admitto</title>
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
