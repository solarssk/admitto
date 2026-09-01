import {
  authFormSubmitScript,
  authTimezoneCaptureScript,
  AUTH_PAGE_CSS,
  AUTH_SSO_BUTTON_ICON_SVG,
  AUTH_PASSKEY_BUTTON_ICON_SVG,
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
 * "Sign in with a passkey" ceremony: discoverable-credential (usernameless) WebAuthn login
 * against /api/auth/login/webauthn/{begin,finish}. Same hand-rolled base64url + WebAuthn call as
 * mfa-page.ts's mfaWebauthnScript (no bundler on this page family, so each inline <script> is
 * self-contained rather than importing a shared helper module). The one real difference from that
 * MFA ceremony: begin's response carries an opaque `ceremony` token (there is no session yet to
 * key the stashed challenge by) that must be echoed back verbatim to finish.
 *
 * `conditionalUiEnabled` also starts the same ceremony with WebAuthn conditional mediation as
 * soon as the browser confirms support - the email field (autocomplete="username webauthn" on
 * this same page) then offers a saved passkey directly in its autofill dropdown, no click on the
 * button required. Errors from that silent, unrequested attempt are never surfaced (including
 * the AbortError the browser raises when the explicit button starts a competing request) - only
 * a ceremony the user actually clicked "Sign in with a passkey" for shows the error box.
 */
function passkeyLoginScript(scriptNonce: string, conditionalUiEnabled: boolean): string {
  return String.raw`<script nonce="${scriptNonce}">
(function () {
  var btn = document.getElementById("passkey-login-btn");
  var errorBox = document.getElementById("passkey-login-error");
  if (!btn) return;
  if (!window.PublicKeyCredential) {
    // No other button is left in the shared list (no SSO providers configured) - hide the
    // now-empty list and its "or" divider too, instead of leaving a dangling divider with
    // nothing above it and the password form right below.
    var list = document.getElementById("auth-alt-signin-list");
    if (list && !list.querySelector(".auth-btn-sso")) {
      list.hidden = true;
      var divider = document.getElementById("auth-alt-signin-divider");
      if (divider) divider.hidden = true;
    }
    return;
  }
  btn.hidden = false;
  var navigated = false;
  // Set only for the auto-started conditional ceremony (never the explicit click) - lets the
  // click handler cancel a still-pending conditional /begin fetch or credentials.get() before
  // starting its own, so the two never race. Without this, whichever WebAuthn call reaches the
  // browser second can abort or get rejected behind the first, making the explicit button
  // intermittently fail on a slow connection.
  var conditionalAbort = null;

  function b64urlToBuffer(b64url) {
    var b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    var pad = b64.length % 4 === 0 ? "" : new Array(5 - (b64.length % 4)).join("=");
    var bin = atob(b64 + pad);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function bufferToB64url(buf) {
    var bytes = new Uint8Array(buf);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function showError() {
    btn.disabled = false;
    if (errorBox) errorBox.hidden = false;
  }

  function runCeremony(conditional) {
    var abortController = null;
    if (conditional) {
      abortController = new AbortController();
      conditionalAbort = abortController;
    } else {
      btn.disabled = true;
      if (errorBox) errorBox.hidden = true;
      // Never let a still-pending auto-started attempt reach the browser after this deliberate
      // click - cancels its /begin fetch if still in flight, or its credentials.get() prompt if
      // already showing, instead of leaving two WebAuthn requests to race each other.
      if (conditionalAbort) {
        conditionalAbort.abort();
        conditionalAbort = null;
      }
    }

    fetch("/api/auth/login/webauthn/begin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: abortController ? abortController.signal : undefined,
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (begin) {
        if (!begin.res.ok || !begin.data.options) throw new Error("begin_failed");
        var ceremony = begin.data.ceremony;
        var publicKey = begin.data.options;
        publicKey.challenge = b64urlToBuffer(publicKey.challenge);
        publicKey.allowCredentials = (publicKey.allowCredentials || []).map(function (cred) {
          return { id: b64urlToBuffer(cred.id), type: cred.type, transports: cred.transports };
        });
        var getOptions = { publicKey: publicKey };
        if (conditional) {
          getOptions.mediation = "conditional";
          getOptions.signal = abortController.signal;
        }
        return navigator.credentials.get(getOptions).then(function (assertion) {
          return { ceremony: ceremony, assertion: assertion };
        });
      })
      .then(function (result) {
        var assertion = result.assertion;
        var timezone;
        try {
          timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
        } catch (e) {
          timezone = undefined;
        }
        return fetch("/api/auth/login/webauthn/finish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ceremony: result.ceremony,
            response: {
              id: assertion.id,
              rawId: bufferToB64url(assertion.rawId),
              type: assertion.type,
              clientExtensionResults: assertion.getClientExtensionResults ? assertion.getClientExtensionResults() : {},
              response: {
                clientDataJSON: bufferToB64url(assertion.response.clientDataJSON),
                authenticatorData: bufferToB64url(assertion.response.authenticatorData),
                signature: bufferToB64url(assertion.response.signature),
                userHandle: assertion.response.userHandle ? bufferToB64url(assertion.response.userHandle) : undefined,
              },
            },
            next: btn.dataset.next,
            timezone: timezone,
          }),
        });
      })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (finish) {
        if (conditional && conditionalAbort === abortController) conditionalAbort = null;
        if (navigated) return;
        if (finish.res.ok && finish.data.ok) {
          navigated = true;
          window.location.href = finish.data.next;
          return;
        }
        if (!conditional) showError();
      })
      .catch(function () {
        if (conditional && conditionalAbort === abortController) conditionalAbort = null;
        // Includes NotAllowedError (user cancelled, timed out, or has no passkey on this
        // device/browser) and, for the conditional ceremony, AbortError (either the browser's own
        // arbitration or the explicit click cancelling it above) - stay on the page, the password
        // form below remains usable either way. Only the ceremony the user actually clicked for
        // reports failure.
        if (!conditional) showError();
      });
  }

  btn.addEventListener("click", function () { runCeremony(false); });
  ${
    conditionalUiEnabled
      ? `if (window.PublicKeyCredential.isConditionalMediationAvailable) {
    window.PublicKeyCredential.isConditionalMediationAvailable()
      .then(function (available) {
        if (available) runCeremony(true);
      })
      .catch(function () {});
  }`
      : ""
  }
})();
</script>`;
}

/**
 * Security headers for server-rendered operator login pages (nonce-gated submit script).
 * Referrer-Policy same-origin is the primary CSRF signal for HTML form POSTs (Safari);
 * Sec-Fetch-Site in same-origin-post.ts is a legacy-UA fallback only.
 */
export function getLoginPageSecurityHeaders(
  scriptNonce: string,
  trustedOrigins: readonly string[] = [],
  secure = false,
): Record<string, string> {
  return getAuthPageInlineScriptHeaders(scriptNonce, trustedOrigins, secure);
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

function renderSsoButtons(ssoProviders: LoginSsoProvider[], next?: string): string {
  return ssoProviders
    .map((p) => {
      const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";
      const startUrl = `/api/auth/oidc/${encodeURIComponent(p.id)}/start${nextQuery}`;
      return `<a href="${esc(startUrl)}" class="auth-btn-secondary auth-btn-sso">${SSO_ICON_SVG}${esc(p.button_label)}</a>`;
    })
    .join("");
}

/**
 * "Sign in with a passkey" button, next to (not replacing) the password form below - hidden by
 * default and only shown by passkeyLoginScript once it confirms the browser supports WebAuthn.
 * `next` rides along as a data attribute (no hidden form field exists for this standalone
 * button) so the script can forward it to /api/auth/login/webauthn/finish and preserve the same
 * post-login destination a password sign-in would have used.
 */
function renderPasskeyLoginButton(next?: string): string {
  const nextAttr = next ? ` data-next="${esc(next)}"` : "";
  return `<button type="button" class="auth-btn-secondary" id="passkey-login-btn" hidden${nextAttr}>${AUTH_PASSKEY_BUTTON_ICON_SVG}Sign in with a passkey</button>`;
}

/** Combined "alternative to typing your password" list: passkey button (if enabled) and/or SSO
 * provider links, one shared divider before the password form - either, both, or neither may be
 * present depending on instance configuration. */
function renderAltSignInBlock(passkeyLoginEnabled: boolean, ssoProviders: LoginSsoProvider[], next?: string): string {
  if (!passkeyLoginEnabled && ssoProviders.length === 0) return "";
  const passkeyButton = passkeyLoginEnabled ? renderPasskeyLoginButton(next) : "";
  const ssoButtons = renderSsoButtons(ssoProviders, next);
  return `<div class="auth-sso-list" id="auth-alt-signin-list">${passkeyButton}${ssoButtons}</div><div class="auth-divider" id="auth-alt-signin-divider">or</div>`;
}

/** Render the operator sign-in form HTML (optional uniform error message). `passkeyLoginEnabled`
 * shows the "Sign in with a passkey" button - callers gate this on both the webauthn_enabled and
 * passkey_login_enabled instance settings (see handleGetLogin), not just one. `passkeyConditionalUiEnabled`
 * additionally runs that same ceremony via WebAuthn conditional mediation as soon as the page
 * loads (offering a passkey directly in the email field's autofill dropdown) - callers gate this
 * on passkeyLoginEnabled already being true, it is never on by itself. */
export function renderLoginForm(
  scriptNonce: string,
  error?: string,
  next?: string,
  ssoProviders: LoginSsoProvider[] = [],
  passkeyLoginEnabled = false,
  passkeyConditionalUiEnabled = false,
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
  const altSignInBlock = renderAltSignInBlock(passkeyLoginEnabled, ssoProviders, next);
  const passkeyErrorBlock = passkeyLoginEnabled
    ? `<div class="auth-webauthn-error" id="passkey-login-error" hidden>${renderNoticeHtml({
        variant: "error",
        role: "alert",
        message: "Could not sign in with your passkey. Try again, or use your email and password below.",
      })}</div>`
    : "";

  const card = `${renderAuthBrand()}
    <h2 class="auth-page-action">Sign in</h2>
    <p class="subtitle">Internal event access gateway</p>
    ${ssoFallbackBlock}
    ${errorBlock}
    ${passkeyErrorBlock}
    ${altSignInBlock}
    <form method="post" action="/login" aria-label="Admitto sign in">
      ${nextField}
      <input type="hidden" name="timezone" value="" autocomplete="off">
      <div class="auth-field">
        <label class="auth-label" for="email">Email</label>
        <input class="auth-input" id="email" type="email" name="email" placeholder="you@example.com" required autocomplete="${passkeyConditionalUiEnabled ? "username webauthn" : "username"}">
      </div>
      <div class="auth-field">
        <label class="auth-label" for="password">Password</label>
        <input class="auth-input" id="password" type="password" name="password" required autocomplete="current-password">
      </div>
      <button class="auth-btn-primary" type="submit">Sign in</button>
    </form>
    <p class="auth-footer">Admitto is an internal tool.<br>Access is managed by your IT administrator.</p>`;

  const passkeyScript = passkeyLoginEnabled
    ? `\n${passkeyLoginScript(scriptNonce, passkeyConditionalUiEnabled)}`
    : "";
  return renderAuthDocument({
    step: "Sign in",
    body: renderAuthPage(card),
    css: AUTH_PAGE_CSS,
    scripts: `${authFormSubmitScript(scriptNonce)}\n${authTimezoneCaptureScript(scriptNonce, { ssoLinks: true })}\n${loginAutofillClearScript(scriptNonce)}${passkeyScript}`,
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
