import { getLoginPageSecurityHeaders } from "./login-page.js";
import {
  AUTH_PAGE_CSS,
  renderAuthBrand,
  renderAuthDocument,
} from "./shared-auth-styles.js";

/** Security headers for server-rendered MFA pages (same policy as login). */
export function getMfaPageSecurityHeaders(): Record<string, string> {
  return getLoginPageSecurityHeaders();
}

/** Render MFA verification form HTML (`/mfa/verify`). */
export function renderMfaVerifyForm(error?: string, next?: string): string {
  const err = error ? `<div class="auth-error" role="alert">${escapeHtml(error)}</div>` : "";
  const nextField = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : "";
  const body = `${renderAuthBrand()}
  <div class="auth-card">
    <h1>Two-factor authentication</h1>
    <p class="subtitle">Enter the code from your authenticator app or a backup recovery code.</p>
    ${err}
    <form method="post" action="/mfa/verify">
      ${nextField}
      <div class="auth-field">
        <label class="auth-label" for="code">Authentication code</label>
        <input class="auth-input" id="code" name="code" type="text" inputmode="text" autocomplete="one-time-code" style="letter-spacing: 0.2em; font-size: 1.1rem;" required>
      </div>
      <label class="auth-check-label">
        <input type="checkbox" name="remember_device" value="1"> Remember this device
      </label>
      <button class="auth-btn-primary" type="submit">Continue</button>
    </form>
  </div>`;
  return renderAuthDocument("Admitto — Two-factor authentication", body, AUTH_PAGE_CSS);
}

/**
 * Render TOTP enrollment page (`/mfa/enroll`) with otpauth URI and one-time backup codes.
 * When `backupCodesAlreadyShown` is true, backup codes are omitted (resume flow).
 */
export function renderMfaEnrollPage(
  otpauthUri: string,
  backupCodes: string[],
  error?: string,
  backupCodesAlreadyShown?: boolean,
  next?: string,
): string {
  const err = error ? `<div class="auth-error" role="alert">${escapeHtml(error)}</div>` : "";
  const nextField = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : "";

  const downloadForm =
    !backupCodesAlreadyShown && backupCodes.length > 0
      ? `<form method="post" action="/mfa/enroll/download-codes" style="margin-top:0.75rem">
      ${next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : ""}
      ${backupCodes.map((c) => `<input type="hidden" name="code" value="${escapeHtml(c)}">`).join("")}
      <button type="submit" class="auth-btn-secondary">Download backup codes</button>
    </form>`
      : "";

  const backupSection = backupCodesAlreadyShown
    ? `<div class="auth-backup"><strong>Backup codes</strong> were already shown — use the codes you saved earlier.</div>`
    : `<div class="auth-backup">
    <strong>Backup codes</strong> — save these now; they will not be shown again:
    <ul>${backupCodes.map((c) => `<li><code>${escapeHtml(c)}</code></li>`).join("")}</ul>
    ${downloadForm}
  </div>`;

  const body = `${renderAuthBrand()}
  <div class="auth-card auth-card-wide">
    <h1>Set up two-factor authentication</h1>
    <p class="subtitle">Scan the QR code in your authenticator app, then confirm with a code.</p>
    <div class="auth-field">
      <p class="auth-label">Authenticator URI</p>
      <code class="auth-uri-code">${escapeHtml(otpauthUri)}</code>
    </div>
    ${backupSection}
    ${err}
    <p class="auth-muted">Save or download your backup codes before confirming — they cannot be recovered from Admitto after setup completes.</p>
    <form method="post" action="/mfa/enroll">
      ${nextField}
      <div class="auth-field">
        <label class="auth-label" for="code">Confirmation code</label>
        <input class="auth-input" id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" required>
      </div>
      <button class="auth-btn-primary" type="submit">Confirm and continue</button>
    </form>
  </div>`;

  return renderAuthDocument("Admitto — Set up two-factor authentication", body, AUTH_PAGE_CSS);
}

/** Render enrollment landing — start setup via CSRF-protected POST only. */
export function renderMfaEnrollStartPage(next?: string): string {
  const nextField = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : "";
  const body = `${renderAuthBrand()}
  <div class="auth-card">
    <h1>Set up two-factor authentication</h1>
    <p class="subtitle">Two-factor authentication is required for your account.</p>
    <p class="auth-muted">Start setup to generate your authenticator secret and one-time backup codes.</p>
    <form method="post" action="/mfa/enroll/start">
      ${nextField}
      <button class="auth-btn-primary" type="submit">Begin setup</button>
    </form>
  </div>`;
  return renderAuthDocument("Admitto — Set up two-factor authentication", body, AUTH_PAGE_CSS);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
