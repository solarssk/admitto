import { PASSWORD_MIN_LENGTH } from "@admitto/auth/constants";
import { PASSWORD_TOO_COMMON_CODE } from "@admitto/auth";
import {
  passwordStrengthAuthScript,
  renderAuthPasswordStrengthMeterHtml,
} from "@admitto/auth/password-strength-script";
import { getAuthPageInlineScriptHeaders } from "./auth-page-security.js";
import { renderNoticeHtml } from "./auth-notice.js";
import {
  authFormSubmitScript,
  AUTH_PAGE_CSS,
  renderAuthBrand,
  renderAuthDocument,
  renderAuthPage,
} from "./shared-auth-styles.js";

/** Escape user-supplied text for safe inclusion in setup page HTML. */
function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Security headers for server-rendered first-run setup page. */
export function getSetupPageSecurityHeaders(scriptNonce: string): Record<string, string> {
  return getAuthPageInlineScriptHeaders(scriptNonce);
}

export type SetupErrorCode =
  | "invalid_email"
  | "password_too_short"
  | typeof PASSWORD_TOO_COMMON_CODE
  | "password_mismatch"
  | "email_taken";

/** Map setup validation codes to user-facing copy. */
export function setupErrorMessage(code?: SetupErrorCode): string | undefined {
  switch (code) {
    case "invalid_email":
      return "Enter a valid email address.";
    case "password_too_short":
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    case PASSWORD_TOO_COMMON_CODE:
      return "This password is too common or predictable. Choose a different one.";
    case "password_mismatch":
      return "Passwords do not match.";
    case "email_taken":
      return "An account with this email already exists.";
    default:
      return undefined;
  }
}

export interface SetupFormValues {
  email?: string;
  display_name?: string;
}

/** Password Rules language hint for password managers (Safari, 1Password, etc.). */
export function setupPasswordRulesAttribute(): string {
  return `minlength: ${PASSWORD_MIN_LENGTH};`;
}

/** Render first-run superadmin bootstrap form (inline strength + confirm-match scripts). */
export function renderSetupPage(
  scriptNonce: string,
  error?: SetupErrorCode,
  values: SetupFormValues = {},
): string {
  const message = setupErrorMessage(error);
  const errorBlock = message
    ? renderNoticeHtml({ variant: "error", role: "alert", message })
    : "";
  const emailValue = values.email ? ` value="${esc(values.email)}"` : "";
  const displayNameValue = values.display_name ? ` value="${esc(values.display_name)}"` : "";
  const passwordRules = esc(setupPasswordRulesAttribute());

  const card = `${renderAuthBrand()}
    <h2 class="auth-page-action">Set up Admitto</h2>
    <p class="subtitle">Create your administrator account to get started.</p>
    ${errorBlock}
    <form method="post" action="/setup" aria-label="Admitto initial setup">
      <div class="auth-field">
        <label class="auth-label" for="email">Email</label>
        <input class="auth-input" id="email" type="email" name="email" placeholder="admin@example.com" required autocomplete="username" inputmode="email" autocapitalize="off"${emailValue}>
      </div>
      <div class="auth-field">
        <label class="auth-label" for="display_name">Display name <span class="auth-label-optional">(optional)</span></label>
        <input class="auth-input" id="display_name" type="text" name="display_name" placeholder="Admin" maxlength="120" autocomplete="name"${displayNameValue}>
      </div>
      <div class="auth-field">
        <label class="auth-label" for="password">Password <span class="auth-label-optional">(at least ${PASSWORD_MIN_LENGTH} characters)</span></label>
        <div class="auth-password-slot">
          <input class="auth-input" id="password" type="password" name="password" required minlength="${PASSWORD_MIN_LENGTH}" autocomplete="new-password" autocapitalize="off" spellcheck="false" passwordrules="${passwordRules}" aria-describedby="password-strength">
          ${renderAuthPasswordStrengthMeterHtml("password")}
        </div>
      </div>
      <div class="auth-field">
        <label class="auth-label" for="confirm_password">Confirm password</label>
        <input class="auth-input" id="confirm_password" type="password" name="confirm_password" required minlength="${PASSWORD_MIN_LENGTH}" autocomplete="new-password" autocapitalize="off" spellcheck="false" aria-describedby="confirm_password-match">
        <p class="auth-field-hint auth-confirm-match" id="confirm_password-match" role="status" aria-live="polite"></p>
      </div>
      <button class="auth-btn-primary" type="submit">Create administrator account</button>
    </form>
    <p class="auth-footer">This page is only shown during initial setup. You will enroll MFA immediately after account creation.</p>`;

  return renderAuthDocument({
    step: "Initial setup",
    body: renderAuthPage(card),
    css: AUTH_PAGE_CSS,
    scripts: `${passwordStrengthAuthScript(scriptNonce)}\n${authFormSubmitScript(scriptNonce)}`,
  });
}
