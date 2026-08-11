import {
  createAuthPageScriptNonce,
  getAuthPageInlineScriptHeaders,
} from "../auth-page-security.js";
import { renderNoticeHtml } from "../auth-notice.js";
import {
  authFormSubmitScript,
  authTimezoneCaptureScript,
  AUTH_PAGE_CSS,
  renderAuthBrand,
  renderAuthDocument,
  renderAuthPage,
} from "../shared-auth-styles.js";

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Security headers for the OIDC account-link step-up page (same CSP as other auth HTML). */
export function getOidcLinkPageSecurityHeaders(
  scriptNonce: string,
  trustedOrigins: readonly string[] = [],
): Record<string, string> {
  return getAuthPageInlineScriptHeaders(scriptNonce, trustedOrigins);
}

export interface RenderOidcLinkFormOptions {
  providerId: string;
  providerName: string;
  requiresTotp: boolean;
  next?: string;
  error?: string;
  /** When omitted, a fresh nonce is generated (callers that set CSP headers should pass theirs). */
  scriptNonce?: string;
}

export function renderOidcLinkForm(options: RenderOidcLinkFormOptions): string {
  const { providerId, providerName, requiresTotp, next, error } = options;
  const scriptNonce = options.scriptNonce ?? createAuthPageScriptNonce();
  const errorBlock = error
    ? renderNoticeHtml({ variant: "error", role: "alert", message: error })
    : "";
  const nextField = next ? `<input type="hidden" name="next" value="${esc(next)}">` : "";
  const totpField = requiresTotp
    ? `<div class="auth-field">
        <label class="auth-label" for="oidc-link-code">Authenticator code</label>
        <input class="auth-input" id="oidc-link-code" name="code" inputmode="numeric" autocomplete="one-time-code" required>
      </div>`
    : "";

  const card = `${renderAuthBrand()}
    <h2 class="auth-page-action">Link ${esc(providerName)}</h2>
    <p class="subtitle">Confirm your password${requiresTotp ? " and authenticator code" : ""} before linking this sign-in method to your account.</p>
    ${errorBlock}
    <form method="post" action="/account/oidc/${esc(providerId)}/link" aria-label="Link identity provider">
      ${nextField}
      <input type="hidden" name="timezone" value="" autocomplete="off">
      <div class="auth-field">
        <label class="auth-label" for="oidc-link-password">Password</label>
        <input class="auth-input" id="oidc-link-password" type="password" name="password" required autocomplete="current-password">
      </div>
      ${totpField}
      <button class="auth-btn-primary" type="submit">Continue to ${esc(providerName)}</button>
    </form>
    <p class="auth-footer"><a href="/operator">Cancel</a></p>`;

  return renderAuthDocument({
    step: `Link ${providerName}`,
    body: renderAuthPage(card),
    css: AUTH_PAGE_CSS,
    scripts: `${authFormSubmitScript(scriptNonce)}\n${authTimezoneCaptureScript(scriptNonce)}`,
  });
}
