import { PASSWORD_MIN_LENGTH } from "@admitto/auth/constants";
import { passwordStrengthAuthScript } from "@admitto/auth/password-strength-script";
import { AUTH_PAGE_ICON_CSP } from "./favicon.js";
import { getLoginPageSecurityHeaders } from "./login-page.js";
import {
  AUTH_FORM_SUBMIT_SCRIPT,
  AUTH_PAGE_CSS,
  renderAuthBrand,
  renderAuthDocument,
  renderAuthPage,
} from "./shared-auth-styles.js";

/** Escape user-supplied text for safe inclusion in setup page HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Security headers for server-rendered first-run setup page. */
export function getSetupPageSecurityHeaders(): Record<string, string> {
  return {
    ...getLoginPageSecurityHeaders(),
    "Content-Security-Policy":
      `default-src 'none'; ${AUTH_PAGE_ICON_CSP}; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'`,
  };
}

export type SetupErrorCode =
  | "invalid_email"
  | "password_too_short"
  | "password_mismatch"
  | "email_taken";

/** Map setup validation codes to user-facing copy. */
export function setupErrorMessage(code?: SetupErrorCode): string | undefined {
  switch (code) {
    case "invalid_email":
      return "Enter a valid email address.";
    case "password_too_short":
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
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
export function renderSetupPage(error?: SetupErrorCode, values: SetupFormValues = {}): string {
  const message = setupErrorMessage(error);
  const errorBlock = message ? `<div class="auth-error" role="alert">${esc(message)}</div>` : "";
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
        <label class="auth-label" for="password">Password</label>
        <input class="auth-input" id="password" type="password" name="password" required minlength="${PASSWORD_MIN_LENGTH}" autocomplete="new-password" autocapitalize="off" spellcheck="false" passwordrules="${passwordRules}" aria-describedby="password-hint">
        <p class="auth-field-hint" id="password-hint">At least ${PASSWORD_MIN_LENGTH} characters.</p>
      </div>
      <div class="auth-field">
        <label class="auth-label" for="confirm_password">Confirm password</label>
        <input class="auth-input" id="confirm_password" type="password" name="confirm_password" required minlength="${PASSWORD_MIN_LENGTH}" autocomplete="new-password" autocapitalize="off" spellcheck="false" aria-describedby="confirm_password-match">
      </div>
      <button class="auth-btn-primary" type="submit">Create administrator account</button>
    </form>
    <p class="auth-footer">This page is only shown during initial setup. You will enroll MFA immediately after account creation.</p>`;

  return renderAuthDocument({
    step: "Initial setup",
    body: renderAuthPage(card),
    css: AUTH_PAGE_CSS,
    scripts: `${passwordStrengthAuthScript()}\n${AUTH_FORM_SUBMIT_SCRIPT}`,
  });
}
