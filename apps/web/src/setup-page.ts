import { getLoginPageSecurityHeaders } from "./login-page.js";
import {
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

/** Security headers for server-rendered first-run setup page (no inline scripts). */
export function getSetupPageSecurityHeaders(): Record<string, string> {
  return getLoginPageSecurityHeaders();
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
      return "Password must be at least 12 characters.";
    case "password_mismatch":
      return "Passwords do not match.";
    case "email_taken":
      return "That email is already registered.";
    default:
      return undefined;
  }
}

export interface SetupFormValues {
  email?: string;
  display_name?: string;
}

/** Render first-run superadmin bootstrap form (no client-side scripts). */
export function renderSetupPage(error?: SetupErrorCode, values: SetupFormValues = {}): string {
  const message = setupErrorMessage(error);
  const errorBlock = message ? `<div class="auth-error" role="alert">${esc(message)}</div>` : "";
  const emailValue = values.email ? ` value="${esc(values.email)}"` : "";
  const displayNameValue = values.display_name ? ` value="${esc(values.display_name)}"` : "";

  const card = `${renderAuthBrand()}
    <h2 class="auth-page-action">Initial setup</h2>
    <p class="subtitle">Create the first superadmin account for this Admitto instance.</p>
    ${errorBlock}
    <form method="post" action="/setup" aria-label="Admitto initial setup">
      <div class="auth-field">
        <label class="auth-label" for="email">Email</label>
        <input class="auth-input" id="email" type="email" name="email" placeholder="admin@example.com" required autocomplete="username"${emailValue}>
      </div>
      <div class="auth-field">
        <label class="auth-label" for="display_name">Display name</label>
        <input class="auth-input" id="display_name" type="text" name="display_name" placeholder="Admin" maxlength="120" autocomplete="name"${displayNameValue}>
      </div>
      <div class="auth-field">
        <label class="auth-label" for="password">Password</label>
        <input class="auth-input" id="password" type="password" name="password" required minlength="12" autocomplete="new-password">
      </div>
      <div class="auth-field">
        <label class="auth-label" for="confirm_password">Confirm password</label>
        <input class="auth-input" id="confirm_password" type="password" name="confirm_password" required minlength="12" autocomplete="new-password">
      </div>
      <button class="auth-btn-primary" type="submit">Create superadmin</button>
    </form>
    <p class="auth-footer">You will enroll MFA immediately after account creation.</p>`;

  return renderAuthDocument({
    step: "Initial setup",
    body: renderAuthPage(card),
    css: AUTH_PAGE_CSS,
  });
}
