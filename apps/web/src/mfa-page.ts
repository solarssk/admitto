import {
  authFormSubmitScript,
  authTimezoneCaptureScript,
  AUTH_PAGE_CSS,
  renderAuthBrand,
  renderAuthDocument,
  renderAuthPage,
} from "./shared-auth-styles.js";
import { renderNoticeHtml } from "./auth-notice.js";
import { getAuthPageInlineScriptHeaders } from "./auth-page-security.js";

/** Security headers for MFA verify (nonce-gated inline script for the OTP digit widget and the
 *  WebAuthn button, which needs `connect-src 'self'` to `fetch()` its own JSON endpoints). */
export function getMfaPageSecurityHeaders(
  scriptNonce: string,
  trustedOrigins: readonly string[] = [],
): Record<string, string> {
  return getAuthPageInlineScriptHeaders(scriptNonce, trustedOrigins);
}

/** MFA enroll allows nonce-gated inline script for clipboard copy and OTP widget. */
export function getMfaEnrollPageSecurityHeaders(
  scriptNonce: string,
  trustedOrigins: readonly string[] = [],
): Record<string, string> {
  return getAuthPageInlineScriptHeaders(scriptNonce, trustedOrigins);
}

interface AuthOtpCodeFieldOptions {
  label: string;
  labelId: string;
  /** Show link to enter a backup recovery code (MFA verify only). */
  allowBackupCode?: boolean;
  /** Focus first digit on load (disable on QR enrollment step). */
  autofocusOtp?: boolean;
  /** Render only the backup-code field, with no digit boxes and no toggle back to them, for an
   * account with no confirmed authenticator app - there is nothing a 6-digit entry could ever
   * validate against, so it isn't offered as an option at all (only meaningful with
   * allowBackupCode). */
  startInBackupMode?: boolean;
}

/** Visible enrollment progress for multi-step MFA setup. */
function renderAuthStepIndicator(step: number, total: number, label: string): string {
  return `<p class="auth-step-indicator" aria-current="step"><span class="auth-step-indicator__meta">Step ${step} of ${total}</span> - ${escapeHtml(label)}</p>`;
}

/** Six centered digit boxes + hidden `code` field for form POST, or (when `startInBackupMode`)
 * just the backup-code field on its own. */
function renderAuthOtpCodeField(options: AuthOtpCodeFieldOptions): string {
  if (options.allowBackupCode && options.startInBackupMode) {
    return `<div class="auth-field">
      <label class="auth-label" for="code">Backup recovery code</label>
      <input class="auth-input" type="text" id="code" name="code" inputmode="text" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX" required autofocus>
    </div>`;
  }

  const digits = Array.from(
    { length: 6 },
    (_, i) =>
      `<input class="auth-otp-digit" type="text" inputmode="numeric" autocomplete="${i === 0 ? "one-time-code" : "off"}" maxlength="1" aria-label="Digit ${i + 1} of 6" data-otp-index="${i}">`,
  ).join("");

  const backupSection = options.allowBackupCode
    ? `<button type="button" class="auth-otp-backup-toggle">Use a backup recovery code</button>
    <div class="auth-otp-backup-panel" hidden>
      <label class="auth-label" for="backup-code-input">Backup recovery code</label>
      <input class="auth-input" id="backup-code-input" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX">
    </div>`
    : "";

  // Span + aria-labelledby on the digit group (not a bare <label> without `for`).
  return `<div class="auth-otp-wrap" data-auth-otp-digits${options.allowBackupCode ? " data-backup-fallback" : ""}${options.autofocusOtp === false ? ' data-autofocus-otp="false"' : ""}>
    <span class="auth-label" id="${escapeHtml(options.labelId)}">${escapeHtml(options.label)}</span>
    <div class="auth-otp-digits" role="group" aria-labelledby="${escapeHtml(options.labelId)}">${digits}</div>
    <input type="hidden" name="code" id="code" required>
    ${backupSection}
  </div>`;
}

// Tabler outline icon (matching AUTH_SSO_BUTTON_ICON_SVG's format/size) for the "Remember this
// device" follow-up button.
const AUTH_REMEMBER_DEVICE_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10" /><path d="M7 20h10" /><path d="M9 16v4" /><path d="M15 16v4" /></svg>`;

/** Render MFA verification form HTML (`/mfa/verify`). `hasWebauthnCredentials` shows the
 * "Use a passkey or security key" button only for a user who actually has one registered - the
 * button also self-hides via script when the browser lacks WebAuthn support. `hasTotp` controls
 * whether the form leads with the 6-digit authenticator-app field (the common case) or, for a
 * user whose only confirmed methods are backup codes and/or a passkey/security key (no
 * authenticator app - e.g. after removing it from My Account), starts with the backup-code field
 * open instead, so the page doesn't ask for a code they have no app to generate. */
export function renderMfaVerifyForm(
  scriptNonce: string,
  error?: string,
  next?: string,
  hasWebauthnCredentials = false,
  hasTotp = true,
): string {
  const err = error
    ? renderNoticeHtml({ variant: "error", role: "alert", message: error })
    : "";
  const nextField = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : "";
  const fallbackHint = hasTotp ? "or use your authenticator code" : "or enter a backup recovery code";
  // Auto-run the passkey/security-key ceremony on load only when it's the account's only real
  // second factor besides backup codes (no authenticator app to fall back to manually) - with a
  // confirmed TOTP method, the code field stays the primary, unprompted path (mfaWebauthnScript
  // still wires up the button either way, for a manual retry or a first attempt).
  const autoStartWebauthn = hasWebauthnCredentials && !hasTotp;
  // Sits right after the subtitle (same slot ${err} uses), not sandwiched between Continue and
  // the passkey button below - it reads as a page-level error either way, not something owned by
  // one specific button.
  const webauthnErrorBox = hasWebauthnCredentials
    ? `<div class="auth-webauthn-error" id="mfa-webauthn-error" hidden>${renderNoticeHtml({
        variant: "error",
        role: "alert",
        message: `Could not verify with your passkey or security key. Try again, ${fallbackHint}.`,
      })}</div>`
    : "";
  const webauthnAutoStartAttr = autoStartWebauthn ? ' data-auto-start="true"' : "";
  const webauthnButton = hasWebauthnCredentials
    ? `<button class="auth-btn-secondary" type="button" id="mfa-webauthn-btn" hidden${webauthnAutoStartAttr}>Use a passkey or security key</button>`
    : "";
  // Auto-start verifies before the user has any real chance to check "Remember this device" -
  // offered as a one-tap follow-up instead, once verification already succeeded (script-shown
  // only for that path; unused - and harmless - otherwise).
  const rememberPrompt = hasWebauthnCredentials
    ? `<div class="auth-remember-prompt" id="mfa-remember-prompt" hidden>
      <p class="subtitle">Verified. Remember this device so you don't need to verify again next time?</p>
      <button class="auth-btn-primary" type="button" id="mfa-remember-yes">${AUTH_REMEMBER_DEVICE_ICON_SVG}Remember this device</button>
      <button class="auth-btn-secondary" type="button" id="mfa-remember-no">Not now</button>
    </div>`
    : "";
  const webauthnOnlySubtitle = autoStartWebauthn
    ? "Continue with your passkey or security key, or enter a backup recovery code below."
    : "Enter one of your backup recovery codes.";
  const subtitleText = hasTotp
    ? "Enter the 6-digit code from your authenticator app."
    : webauthnOnlySubtitle;
  const card = `${renderAuthBrand()}
    <h2 class="auth-page-action">Two-factor authentication</h2>
    <p class="subtitle">${subtitleText}</p>
    ${err}
    ${webauthnErrorBox}
    <form method="post" action="/mfa/verify">
      ${nextField}
      <input type="hidden" name="timezone" value="" autocomplete="off">
      ${renderAuthOtpCodeField({
        label: "Authentication code",
        labelId: "mfa-code-label",
        allowBackupCode: true,
        startInBackupMode: !hasTotp,
      })}
      <label class="auth-check-label">
        <input type="checkbox" name="remember_device" value="1"> Remember this device
      </label>
      <button class="auth-btn-primary" type="submit">Continue</button>
      ${webauthnButton}
    </form>
    ${rememberPrompt}`;
  return renderAuthDocument({
    step: "Two-factor authentication",
    body: renderAuthPage(card),
    css: AUTH_PAGE_CSS,
    scripts: `${mfaOtpDigitsScript(scriptNonce)}\n${authFormSubmitScript(scriptNonce)}\n${authTimezoneCaptureScript(scriptNonce)}${
      hasWebauthnCredentials ? `\n${mfaWebauthnScript(scriptNonce)}` : ""
    }`,
  });
}

export interface MfaEnrollQrPageOptions {
  scriptNonce: string;
  otpauthUri: string;
  setupKey: string;
  qrDataUri: string;
  error?: string;
  next?: string;
  /** 4 when the instance also offers WebAuthn as a choice (an extra step ahead of this one),
   * 3 on an instance where TOTP is the only option and this is reached directly. */
  totalSteps?: 3 | 4;
}

/** QR + setup key + TOTP confirmation (no backup codes yet) - step 2 of 3 (TOTP the only
 * option) or 3 of 4 (chosen from the method step). */
export function renderMfaEnrollQrPage(options: MfaEnrollQrPageOptions): string {
  const { scriptNonce, otpauthUri, setupKey, qrDataUri, error, next, totalSteps = 3 } = options;
  const err = error
    ? renderNoticeHtml({ variant: "error", role: "alert", message: error })
    : "";
  const nextField = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : "";
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";
  // Only when this step was reached via a method choice (totalSteps === 4) - the 3-step,
  // TOTP-only flow has no other method to go back to.
  const backToMethodLink =
    totalSteps === 4
      ? `<a class="auth-btn-secondary auth-enroll-back-link" href="/mfa/enroll/method${nextQuery}">Choose a different method</a>`
      : "";

  const setupSection =
    otpauthUri && setupKey && qrDataUri
      ? `<div class="auth-mfa-setup">
    <div class="auth-qr-wrap">
      <img class="auth-qr" src="${escapeHtml(qrDataUri)}" width="200" height="200" alt="Scan with your authenticator app">
    </div>
    <p class="auth-muted auth-mfa-setup-hint">Scan the QR code with your authenticator app, or copy the setup key below.</p>
    <div class="auth-field">
      <label class="auth-label" for="enroll-secret">Setup key</label>
      <input class="auth-input auth-secret-input" id="enroll-secret" type="text" readonly value="${escapeHtml(setupKey)}" aria-label="Admitto authenticator setup key">
    </div>
    <div class="auth-mfa-actions">
      <button type="button" class="auth-btn-secondary" id="copy-enroll-secret">Copy setup key</button>
      <span class="auth-mfa-mobile-only">
        <a class="auth-btn-secondary auth-btn-link" href="${escapeHtml(otpauthUri)}" title="Open this setup link in your authenticator app">Try opening in your authenticator app</a>
      </span>
    </div>
    <p class="auth-muted auth-mfa-desktop-hint">On this computer: open your password manager or authenticator, choose Add one-time password, then scan this QR code from the screen or paste the setup key.</p>
    <details class="auth-otpauth-details">
      <summary class="auth-muted">Show full otpauth URI</summary>
      <code class="auth-uri-code">${escapeHtml(otpauthUri)}</code>
    </details>
  </div>`
      : "";

  const card = `${renderAuthBrand()}
    ${renderAuthStepIndicator(totalSteps === 4 ? 3 : 2, totalSteps, "Scan and confirm")}
    <h2 class="auth-page-action">Set up two-factor authentication</h2>
    <p class="subtitle">Scan the QR code in your authenticator app, then confirm with a code.</p>
    ${setupSection}
    ${err}
    <form method="post" action="/mfa/enroll">
      ${nextField}
      ${renderAuthOtpCodeField({
        label: "Confirmation code",
        labelId: "enroll-code-label",
        autofocusOtp: false,
      })}
      <button class="auth-btn-primary" type="submit">Confirm and continue</button>
    </form>
    ${backToMethodLink}`;

  return renderAuthDocument({
    step: "Set up two-factor authentication",
    body: renderAuthPage(card, true),
    css: AUTH_PAGE_CSS,
    scripts: `${mfaOtpDigitsScript(scriptNonce)}\n${mfaEnrollCopyScript(scriptNonce)}\n${authFormSubmitScript(scriptNonce)}`,
  });
}

export interface MfaEnrollBackupCodesPageOptions {
  scriptNonce: string;
  backupCodes: string[];
  codesUnavailable?: boolean;
  error?: string;
  next?: string;
  /** See MfaEnrollQrPageOptions.totalSteps - same instance-wide reasoning. */
  totalSteps?: 3 | 4;
}

/** One-time backup recovery codes before app access - final step regardless of which method
 * (TOTP or WebAuthn) was just confirmed. */
export function renderMfaEnrollBackupCodesPage(options: MfaEnrollBackupCodesPageOptions): string {
  const { scriptNonce, backupCodes, codesUnavailable, error, next, totalSteps = 3 } = options;
  const err = error
    ? renderNoticeHtml({ variant: "error", role: "alert", message: error })
    : "";
  const nextField = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : "";

  const downloadForm =
    backupCodes.length > 0
      ? `<form method="post" action="/mfa/enroll/download-codes" data-auth-no-submit-lock="true" style="margin-top:0.75rem">
      ${nextField}
      ${backupCodes.map((c) => `<input type="hidden" name="code" value="${escapeHtml(c)}">`).join("")}
      <button type="submit" class="auth-btn-secondary">Download backup codes</button>
    </form>`
      : "";

  const codesBlock =
    backupCodes.length > 0
      ? `<div class="auth-backup">
    <strong>Backup codes.</strong> Save these now; they will not be shown again:
    <ul>${backupCodes.map((c) => `<li><code>${escapeHtml(c)}</code></li>`).join("")}</ul>
    ${downloadForm}
  </div>`
      : `<div class="auth-backup auth-backup-muted">
    <strong>Backup codes.</strong> Use the codes you already saved. They cannot be shown again from Admitto.
  </div>`;

  const card = `${renderAuthBrand()}
    ${renderAuthStepIndicator(totalSteps, totalSteps, "Save backup codes")}
    <h2 class="auth-page-action">Save your backup codes</h2>
    <p class="subtitle">Store these recovery codes somewhere safe. You will need them if you lose access to your authenticator.</p>
    ${codesUnavailable ? `<p class="auth-muted">This server session no longer has your codes in memory. If you did not save them, contact an administrator for MFA reset.</p>` : ""}
    ${codesBlock}
    ${err}
    <form method="post" action="/mfa/enroll/backup-codes">
      ${nextField}
      <button class="auth-btn-primary" type="submit">I saved my backup codes</button>
    </form>`;

  return renderAuthDocument({
    step: "Save backup codes",
    body: renderAuthPage(card, true),
    css: AUTH_PAGE_CSS,
    scripts: authFormSubmitScript(scriptNonce),
  });
}

/** Enrollment landing. On an instance with WebAuthn enabled, "Begin setup" leads to the method
 * choice step instead of starting TOTP directly (4-step flow); otherwise unchanged, straight to
 * TOTP (3-step flow, no point offering a "choice" of one). */
export function renderMfaEnrollStartPage(scriptNonce: string, next?: string, webauthnEnabled = false): string {
  const nextField = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : "";
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";
  const beginAction = webauthnEnabled
    ? `<a class="auth-btn-primary" href="/mfa/enroll/method${nextQuery}">Begin setup</a>`
    : `<form method="post" action="/mfa/enroll/start">
      ${nextField}
      <button class="auth-btn-primary" type="submit">Begin setup</button>
    </form>`;
  const card = `${renderAuthBrand()}
    ${renderAuthStepIndicator(1, webauthnEnabled ? 4 : 3, "Get started")}
    <h2 class="auth-page-action">Set up two-factor authentication</h2>
    <p class="subtitle">Two-factor authentication is required for your account.</p>
    <p class="auth-muted">${
      webauthnEnabled
        ? "You will choose an authenticator app or a passkey/security key, then save one-time backup codes before continuing."
        : "You will scan a QR code in your authenticator app, then save one-time backup codes before continuing."
    }</p>
    ${beginAction}`;
  return renderAuthDocument({
    step: "Set up two-factor authentication",
    body: renderAuthPage(card, true),
    css: AUTH_PAGE_CSS,
    scripts: authFormSubmitScript(scriptNonce),
  });
}

// Tabler outline icons (matching AUTH_SSO_BUTTON_ICON_SVG's format/size), one per method choice.
const AUTH_METHOD_ICON_AUTHENTICATOR_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 5a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-14" /><path d="M11 4h2" /><path d="M12 17v.01" /></svg>`;
const AUTH_METHOD_ICON_PASSKEY_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M18.9 7a8 8 0 0 1 1.1 5v1a6 6 0 0 0 .8 3" /><path d="M8 11a4 4 0 0 1 8 0v1a10 10 0 0 0 2 6" /><path d="M12 11v2a14 14 0 0 0 2.5 8" /><path d="M8 15a18 18 0 0 0 1.8 6" /><path d="M4.9 19a22 22 0 0 1 -.9 -7v-1a8 8 0 0 1 12 -6.95" /></svg>`;
const AUTH_METHOD_ICON_SECURITY_KEY_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M7 8h10v8a5 5 0 0 1 -10 0l0 -8" /><path d="M9 8v-5h6v5" /></svg>`;

/** Choice of second-factor method - only reachable when the instance has WebAuthn enabled
 * (renderMfaEnrollStartPage only links here in that case; the route handler re-checks too).
 * "Passkey"/"Security key" (not the plural "Passkeys"/"Security keys") match My Account's own
 * wording for a single credential (AccountPage.tsx) - plural is reserved there for a settings
 * section that can hold several. "(YubiKey)" on Security key mirrors that same file's existing
 * "Security key (YubiKey)" label, the concrete hint that a security key means a small USB/NFC
 * device like it, not another on-screen abstraction. */
export function renderMfaEnrollMethodPage(scriptNonce: string, next?: string): string {
  const nextField = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : "";
  const nextQuery = next ? `&next=${encodeURIComponent(next)}` : "";
  const card = `${renderAuthBrand()}
    ${renderAuthStepIndicator(2, 4, "Choose your method")}
    <h2 class="auth-page-action">Set up two-factor authentication</h2>
    <p class="subtitle">Choose how you will confirm it is you when you sign in. You can add other methods later from My Account.</p>
    <div class="auth-enroll-method-list">
      <form method="post" action="/mfa/enroll/start">
        ${nextField}
        <button class="auth-btn-primary" type="submit">${AUTH_METHOD_ICON_AUTHENTICATOR_SVG}Authenticator app</button>
      </form>
      <a class="auth-btn-secondary" href="/mfa/enroll/webauthn?attachment=platform${nextQuery}">${AUTH_METHOD_ICON_PASSKEY_SVG}Passkey</a>
      <a class="auth-btn-secondary" href="/mfa/enroll/webauthn?attachment=cross-platform${nextQuery}">${AUTH_METHOD_ICON_SECURITY_KEY_SVG}Security key (YubiKey)</a>
    </div>`;
  return renderAuthDocument({
    step: "Set up two-factor authentication",
    body: renderAuthPage(card, true),
    css: AUTH_PAGE_CSS,
    scripts: authFormSubmitScript(scriptNonce),
  });
}

/** Passkey/security-key registration during first-time enrollment - runs the ceremony
 * automatically on load (this is a fresh setup, not a fallback, so there is no reason to make
 * the user click first), with a manual retry available if it is cancelled or fails. */
export function renderMfaEnrollWebauthnPage(
  scriptNonce: string,
  attachment: "platform" | "cross-platform",
  next?: string,
): string {
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";
  const methodLabel = attachment === "platform" ? "passkey" : "security key (YubiKey)";
  const card = `${renderAuthBrand()}
    ${renderAuthStepIndicator(3, 4, attachment === "platform" ? "Add a passkey" : "Add a security key")}
    <h2 class="auth-page-action">Set up two-factor authentication</h2>
    <p class="subtitle">Continue with your ${methodLabel}.</p>
    <div class="auth-webauthn-error" id="mfa-enroll-webauthn-error" hidden>${renderNoticeHtml({
      variant: "error",
      role: "alert",
      message: `Could not register your ${methodLabel}. Try again, or choose a different method.`,
    })}</div>
    <button class="auth-btn-primary" type="button" id="mfa-enroll-webauthn-btn" data-attachment="${attachment}">Continue with ${methodLabel}</button>
    <p class="auth-field-hint" id="mfa-enroll-webauthn-hint" hidden>Waiting for your browser's passkey or security key prompt. This can take a moment, especially if it opens a password manager or another device.</p>
    <a class="auth-btn-secondary auth-enroll-back-link" href="/mfa/enroll/method${nextQuery}">Choose a different method</a>`;
  return renderAuthDocument({
    step: "Set up two-factor authentication",
    body: renderAuthPage(card, true),
    css: AUTH_PAGE_CSS,
    scripts: `${authFormSubmitScript(scriptNonce)}\n${mfaEnrollWebauthnScript(scriptNonce)}`,
  });
}

function mfaOtpDigitsScript(scriptNonce: string): string {
  return String.raw`<script nonce="${scriptNonce}">
(function () {
  document.querySelectorAll("[data-auth-otp-digits]").forEach(function (wrap) {
    var hidden = wrap.querySelector('input[type="hidden"][name="code"]');
    var digits = Array.prototype.slice.call(wrap.querySelectorAll(".auth-otp-digit"));
    var digitGroup = wrap.querySelector(".auth-otp-digits");
    var backupToggle = wrap.querySelector(".auth-otp-backup-toggle");
    var backupPanel = wrap.querySelector(".auth-otp-backup-panel");
    var backupInput = backupPanel && backupPanel.querySelector("input");
    var usingBackup = false;
    if (!hidden || digits.length === 0) return;

    function syncHidden() {
      if (usingBackup && backupInput) {
        hidden.value = backupInput.value.trim();
        hidden.required = false;
        backupInput.required = true;
      } else {
        hidden.value = digits.map(function (d) { return d.value; }).join("");
        hidden.required = true;
        if (backupInput) backupInput.required = false;
      }
    }

    function focusDigit(i) {
      if (i >= 0 && i < digits.length) digits[i].focus();
    }

    var form = wrap.closest("form");
    if (form) form.addEventListener("submit", syncHidden);

    function maybeAutoSubmit() {
      if (usingBackup) return;
      var filled = digits.every(function (d) { return d.value.length === 1; });
      if (!filled || !form) return;
      syncHidden();
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.submit();
    }

    digits.forEach(function (input, idx) {
      input.addEventListener("input", function () {
        var v = input.value.replace(/\D/g, "");
        if (v.length > 1) {
          // Multi-digit value: password manager filled via execCommand (input event, not paste)
          for (var j = 0; j < digits.length; j++) digits[j].value = v[j] || "";
          syncHidden();
          focusDigit(Math.min(v.length - 1, digits.length - 1));
          maybeAutoSubmit();
          return;
        }
        input.value = v.slice(-1);
        if (input.value && idx < digits.length - 1) focusDigit(idx + 1);
        syncHidden();
        maybeAutoSubmit();
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !input.value && idx > 0) {
          e.preventDefault();
          focusDigit(idx - 1);
        }
        if (e.key === "ArrowLeft" && idx > 0) focusDigit(idx - 1);
        if (e.key === "ArrowRight" && idx < digits.length - 1) focusDigit(idx + 1);
      });
      input.addEventListener("paste", function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "");
        for (var i = 0; i < digits.length; i++) digits[i].value = text[i] || "";
        syncHidden();
        focusDigit(Math.min(text.length, digits.length - 1));
        maybeAutoSubmit();
      });
    });

    if (backupToggle && backupPanel && backupInput) {
      backupInput.addEventListener("input", syncHidden);
      backupToggle.addEventListener("click", function () {
        usingBackup = !usingBackup;
        backupPanel.hidden = !usingBackup;
        digitGroup.hidden = usingBackup;
        backupToggle.textContent = usingBackup
          ? "Use authenticator code"
          : "Use a backup recovery code";
        if (usingBackup) {
          backupInput.focus();
        } else {
          digits.forEach(function (d) { d.value = ""; });
          focusDigit(0);
        }
        syncHidden();
      });
    }

    if (wrap.dataset.autofocusOtp !== "false") {
      focusDigit(0);
    }
  });
})();
</script>`;
}

/** Login-time "Use a passkey or security key" button: fetch a challenge, run
 * `navigator.credentials.get()`, submit the assertion, a hand-rolled base64url + WebAuthn call
 * (no `@simplewebauthn/browser`; this page ships no bundler, unlike the admin SPA's registration
 * flow). Any failure (cancelled, wrong key, network) falls back silently to the still-usable code
 * form instead of blocking the page. */
function mfaWebauthnScript(scriptNonce: string): string {
  return String.raw`<script nonce="${scriptNonce}">
(function () {
  var btn = document.getElementById("mfa-webauthn-btn");
  var errorBox = document.getElementById("mfa-webauthn-error");
  if (!btn || !window.PublicKeyCredential) return;
  btn.hidden = false;

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

  // Auto-start verifies before the user has any real chance to check "Remember this device" -
  // the native passkey/security-key prompt takes over within a network round-trip of page load,
  // long before a person could read the page and act. Offer it as a one-tap follow-up instead,
  // right here on success, rather than silently never remembering the device on that path.
  function showRememberPrompt(next) {
    var prompt = document.getElementById("mfa-remember-prompt");
    var form = btn.closest("form");
    if (!prompt) {
      window.location.href = next;
      return;
    }
    if (form) form.hidden = true;
    prompt.hidden = false;
    var yesBtn = document.getElementById("mfa-remember-yes");
    var noBtn = document.getElementById("mfa-remember-no");
    function goNext() {
      window.location.href = next;
    }
    if (yesBtn) {
      yesBtn.addEventListener("click", function () {
        yesBtn.disabled = true;
        if (noBtn) noBtn.disabled = true;
        fetch("/api/auth/mfa/remember-device", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
          .catch(function () {
            // Best-effort - the account is already fully signed in either way, so a failure here
            // should never block navigation.
          })
          .then(goNext);
      });
    }
    if (noBtn) noBtn.addEventListener("click", goNext);
  }

  function runCeremony() {
    btn.disabled = true;
    if (errorBox) errorBox.hidden = true;
    var remembered = false;

    fetch("/api/auth/mfa/webauthn/begin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (begin) {
        if (!begin.res.ok || !begin.data.options) throw new Error("begin_failed");
        var publicKey = begin.data.options;
        publicKey.challenge = b64urlToBuffer(publicKey.challenge);
        publicKey.allowCredentials = (publicKey.allowCredentials || []).map(function (cred) {
          return { id: b64urlToBuffer(cred.id), type: cred.type, transports: cred.transports };
        });
        return navigator.credentials.get({ publicKey: publicKey });
      })
      .then(function (assertion) {
        var form = btn.closest("form");
        var nextInput = form ? form.querySelector('input[name="next"]') : null;
        var rememberInput = form ? form.querySelector('input[name="remember_device"]') : null;
        remembered = !!(rememberInput && rememberInput.checked);
        var timezone;
        try {
          timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
        } catch (e) {
          timezone = undefined;
        }
        return fetch("/api/auth/mfa/webauthn/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
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
            remember_device: remembered,
            next: nextInput ? nextInput.value : undefined,
            timezone: timezone,
          }),
        });
      })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (verify) {
        if (verify.res.ok && verify.data.ok) {
          if (btn.dataset.autoStart === "true" && !remembered) {
            showRememberPrompt(verify.data.next);
            return;
          }
          window.location.href = verify.data.next;
          return;
        }
        showError();
      })
      .catch(function () {
        // Includes NotAllowedError (user cancelled/timed out) - stay on the page, code form
        // remains usable.
        showError();
      });
  }

  btn.addEventListener("click", runCeremony);
  // Set server-side only when this is the account's sole real second factor (no confirmed
  // authenticator app) - runs the ceremony immediately instead of waiting for a click, with the
  // backup-code field already visible and usable if it's cancelled or fails.
  if (btn.dataset.autoStart === "true") runCeremony();
})();
</script>`;
}

/** First-time enrollment via a passkey/security key: registration counterpart of
 * mfaWebauthnScript's login-time assertion - `navigator.credentials.create()`, submit the new
 * credential, redirect to the backup-codes step. Same hand-rolled base64url + WebAuthn call
 * (no bundler on this page family), auto-run on load since this page is reached only after the
 * user already chose this method on the previous step. */
function mfaEnrollWebauthnScript(scriptNonce: string): string {
  return String.raw`<script nonce="${scriptNonce}">
(function () {
  var btn = document.getElementById("mfa-enroll-webauthn-btn");
  var errorBox = document.getElementById("mfa-enroll-webauthn-error");
  var hint = document.getElementById("mfa-enroll-webauthn-hint");
  if (!btn) return;

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
    if (hint) hint.hidden = true;
  }

  if (!window.PublicKeyCredential) {
    showError();
    return;
  }

  function runCeremony() {
    btn.disabled = true;
    if (errorBox) errorBox.hidden = true;
    if (hint) hint.hidden = false;
    var attachment = btn.dataset.attachment;

    fetch("/api/auth/mfa/webauthn/register/begin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachment: attachment }),
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (begin) {
        if (!begin.res.ok || !begin.data.options) throw new Error("begin_failed");
        var publicKey = begin.data.options;
        publicKey.challenge = b64urlToBuffer(publicKey.challenge);
        publicKey.user.id = b64urlToBuffer(publicKey.user.id);
        publicKey.excludeCredentials = (publicKey.excludeCredentials || []).map(function (cred) {
          return { id: b64urlToBuffer(cred.id), type: cred.type, transports: cred.transports };
        });
        return navigator.credentials.create({ publicKey: publicKey });
      })
      .then(function (credential) {
        var response = credential.response;
        return fetch("/api/auth/mfa/webauthn/register/finish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attachment: attachment,
            response: {
              id: credential.id,
              rawId: bufferToB64url(credential.rawId),
              type: credential.type,
              authenticatorAttachment: credential.authenticatorAttachment || undefined,
              clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
              response: {
                clientDataJSON: bufferToB64url(response.clientDataJSON),
                attestationObject: bufferToB64url(response.attestationObject),
                transports: response.getTransports ? response.getTransports() : undefined,
                authenticatorData: response.getAuthenticatorData ? bufferToB64url(response.getAuthenticatorData()) : undefined,
                publicKeyAlgorithm: response.getPublicKeyAlgorithm ? response.getPublicKeyAlgorithm() : undefined,
                publicKey: response.getPublicKey && response.getPublicKey() ? bufferToB64url(response.getPublicKey()) : undefined,
              },
            },
          }),
        });
      })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (finish) {
        if (finish.res.ok && finish.data.ok) {
          window.location.href = finish.data.next;
          return;
        }
        showError();
      })
      .catch(function () {
        // Includes NotAllowedError (user cancelled/timed out) - the "Choose a different method"
        // link stays usable either way.
        showError();
      });
  }

  btn.addEventListener("click", runCeremony);
  runCeremony();
})();
</script>`;
}

function mfaEnrollCopyScript(scriptNonce: string): string {
  return `<script nonce="${scriptNonce}">
(function () {
  var btn = document.getElementById("copy-enroll-secret");
  var input = document.getElementById("enroll-secret");
  if (!btn || !input) return;
  btn.addEventListener("click", function () {
    var text = input.value;
    function done() {
      var prev = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(function () { btn.textContent = prev; }, 2000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        input.focus();
        input.select();
      });
      return;
    }
    input.focus();
    input.select();
  });
})();
</script>`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
