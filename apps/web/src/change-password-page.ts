import { PASSWORD_MIN_LENGTH } from "@admitto/auth/constants";
import { PASSWORD_TOO_COMMON_CODE } from "@admitto/auth";
import {
  passwordStrengthAuthScript,
  renderAuthPasswordStrengthMeterHtml,
} from "@admitto/auth/password-strength-script";
import { getAuthPageInlineScriptHeaders } from "./auth-page-security.js";
import {
  authFormSubmitScript,
  AUTH_PAGE_CSS,
  renderAuthBrand,
  renderAuthDocument,
  renderAuthPage,
} from "./shared-auth-styles.js";

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Security headers for the forced password-change page. */
export function getChangePasswordPageSecurityHeaders(scriptNonce: string): Record<string, string> {
  return getAuthPageInlineScriptHeaders(scriptNonce);
}

const PASSWORD_MISMATCH = "password_mismatch";
const PASSWORD_TOO_SHORT = "password_too_short";
const PASSWORD_INVALID = "password_invalid";
export const PASSWORD_COMPLETE_FAILED = "password_complete_failed";

function errorMessage(error?: string): string | undefined {
  if (error === PASSWORD_MISMATCH) return "Passwords do not match.";
  if (error === PASSWORD_TOO_SHORT) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (error === PASSWORD_TOO_COMMON_CODE) {
    return "This password is too common or predictable. Choose a different one.";
  }
  if (error === PASSWORD_INVALID) return "Could not update password. Try again.";
  if (error === PASSWORD_COMPLETE_FAILED) {
    return "Password updated, but sign-in could not be completed. Try logging in again.";
  }
  return undefined;
}

/** Server-rendered forced password change form. */
export function renderChangePasswordForm(scriptNonce: string, error?: string): string {
  const message = errorMessage(error);
  const errorBlock = message ? `<div class="auth-error" role="alert">${esc(message)}</div>` : "";
  const passwordRules = esc(`minlength: ${PASSWORD_MIN_LENGTH};`);
  const card = `${renderAuthBrand()}
    <h2 class="auth-page-action">Change password</h2>
    <p class="subtitle">Your administrator requires a new password before you can continue.</p>
    ${errorBlock}
    <form method="post" action="/change-password" aria-label="Change password">
      <div class="auth-field">
        <label class="auth-label" for="password">New password <span class="auth-label-optional">(at least ${PASSWORD_MIN_LENGTH} characters)</span></label>
        <div class="auth-password-slot">
          <input class="auth-input" id="password" name="password" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" passwordrules="${passwordRules}" required minlength="${PASSWORD_MIN_LENGTH}" aria-describedby="password-strength">
          ${renderAuthPasswordStrengthMeterHtml("password")}
        </div>
      </div>
      <div class="auth-field">
        <label class="auth-label" for="password_confirm">Confirm password</label>
        <input class="auth-input" id="password_confirm" name="password_confirm" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" required minlength="${PASSWORD_MIN_LENGTH}" aria-describedby="password_confirm-match">
        <p class="auth-field-hint auth-confirm-match" id="password_confirm-match" role="status" aria-live="polite"></p>
      </div>
      <button type="submit" class="auth-btn-primary">Save password</button>
    </form>`;

  return renderAuthDocument({
    step: "Change password",
    body: renderAuthPage(card),
    css: AUTH_PAGE_CSS,
    scripts: `${passwordStrengthAuthScript(scriptNonce)}\n${authFormSubmitScript(scriptNonce)}`,
  });
}

export { PASSWORD_MISMATCH, PASSWORD_TOO_SHORT, PASSWORD_TOO_COMMON_CODE as PASSWORD_TOO_COMMON, PASSWORD_INVALID };
