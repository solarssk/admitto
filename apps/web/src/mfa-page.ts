import {
  authFormSubmitScript,
  AUTH_PAGE_CSS,
  renderAuthBrand,
  renderAuthDocument,
  renderAuthPage,
} from "./shared-auth-styles.js";
import { renderNoticeHtml } from "./auth-notice.js";
import { getAuthPageInlineScriptHeaders } from "./auth-page-security.js";

/** Security headers for MFA verify (nonce-gated inline script for OTP digit widget). */
export function getMfaPageSecurityHeaders(scriptNonce: string): Record<string, string> {
  return getAuthPageInlineScriptHeaders(scriptNonce);
}

/** MFA enroll allows nonce-gated inline script for clipboard copy and OTP widget. */
export function getMfaEnrollPageSecurityHeaders(scriptNonce: string): Record<string, string> {
  return getAuthPageInlineScriptHeaders(scriptNonce);
}

interface AuthOtpCodeFieldOptions {
  label: string;
  labelId: string;
  /** Show link to enter a backup recovery code (MFA verify only). */
  allowBackupCode?: boolean;
  /** Focus first digit on load (disable on QR enrollment step). */
  autofocusOtp?: boolean;
}

/** Visible enrollment progress for multi-step MFA setup. */
function renderAuthStepIndicator(step: number, total: number, label: string): string {
  return `<p class="auth-step-indicator" aria-current="step"><span class="auth-step-indicator__meta">Step ${step} of ${total}</span> - ${escapeHtml(label)}</p>`;
}

/** Six centered digit boxes + hidden `code` field for form POST. */
function renderAuthOtpCodeField(options: AuthOtpCodeFieldOptions): string {
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

/** Render MFA verification form HTML (`/mfa/verify`). */
export function renderMfaVerifyForm(scriptNonce: string, error?: string, next?: string): string {
  const err = error
    ? renderNoticeHtml({ variant: "error", role: "alert", message: error })
    : "";
  const nextField = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : "";
  const card = `${renderAuthBrand()}
    <h2 class="auth-page-action">Two-factor authentication</h2>
    <p class="subtitle">Enter the 6-digit code from your authenticator app.</p>
    ${err}
    <form method="post" action="/mfa/verify">
      ${nextField}
      ${renderAuthOtpCodeField({
        label: "Authentication code",
        labelId: "mfa-code-label",
        allowBackupCode: true,
      })}
      <label class="auth-check-label">
        <input type="checkbox" name="remember_device" value="1"> Remember this device
      </label>
      <button class="auth-btn-primary" type="submit">Continue</button>
    </form>`;
  return renderAuthDocument({
    step: "Two-factor authentication",
    body: renderAuthPage(card),
    css: AUTH_PAGE_CSS,
    scripts: `${mfaOtpDigitsScript(scriptNonce)}\n${authFormSubmitScript(scriptNonce)}`,
  });
}

export interface MfaEnrollQrPageOptions {
  scriptNonce: string;
  otpauthUri: string;
  setupKey: string;
  qrDataUri: string;
  error?: string;
  next?: string;
}

/** Step 2: QR + setup key + TOTP confirmation (no backup codes yet). */
export function renderMfaEnrollQrPage(options: MfaEnrollQrPageOptions): string {
  const { scriptNonce, otpauthUri, setupKey, qrDataUri, error, next } = options;
  const err = error
    ? renderNoticeHtml({ variant: "error", role: "alert", message: error })
    : "";
  const nextField = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : "";

  const setupSection =
    otpauthUri && setupKey && qrDataUri
      ? `<div class="auth-mfa-setup">
    <div class="auth-qr-wrap">
      <img class="auth-qr" src="${escapeHtml(qrDataUri)}" width="200" height="200" alt="Scan with your authenticator app">
    </div>
    <p class="auth-muted auth-mfa-setup-hint">Scan the QR code, or copy the setup key into Bitwarden, 1Password, or another authenticator.</p>
    <div class="auth-field">
      <label class="auth-label" for="enroll-secret">Setup key</label>
      <input class="auth-input auth-secret-input" id="enroll-secret" type="text" readonly value="${escapeHtml(setupKey)}" aria-label="Admitto authenticator setup key">
    </div>
    <div class="auth-mfa-actions">
      <button type="button" class="auth-btn-secondary" id="copy-enroll-secret">Copy setup key</button>
      <a class="auth-btn-secondary auth-btn-link" href="${escapeHtml(otpauthUri)}" title="Add Admitto authenticator to your password manager">Open in password manager</a>
    </div>
    <details class="auth-otpauth-details">
      <summary class="auth-muted">Show full otpauth URI</summary>
      <code class="auth-uri-code">${escapeHtml(otpauthUri)}</code>
    </details>
  </div>`
      : "";

  const card = `${renderAuthBrand()}
    ${renderAuthStepIndicator(2, 3, "Scan and confirm")}
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
    </form>`;

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
}

/** Step 3: one-time backup recovery codes before app access. */
export function renderMfaEnrollBackupCodesPage(options: MfaEnrollBackupCodesPageOptions): string {
  const { scriptNonce, backupCodes, codesUnavailable, error, next } = options;
  const err = error
    ? renderNoticeHtml({ variant: "error", role: "alert", message: error })
    : "";
  const nextField = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : "";

  const downloadForm =
    backupCodes.length > 0
      ? `<form method="post" action="/mfa/enroll/download-codes" style="margin-top:0.75rem">
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
    ${renderAuthStepIndicator(3, 3, "Save backup codes")}
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

/** Step 1: enrollment landing — start setup via CSRF-protected POST only. */
export function renderMfaEnrollStartPage(scriptNonce: string, next?: string): string {
  const nextField = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : "";
  const card = `${renderAuthBrand()}
    ${renderAuthStepIndicator(1, 3, "Get started")}
    <h2 class="auth-page-action">Set up two-factor authentication</h2>
    <p class="subtitle">Two-factor authentication is required for your account.</p>
    <p class="auth-muted">You will scan a QR code in your authenticator app, then save one-time backup codes before continuing.</p>
    <form method="post" action="/mfa/enroll/start">
      ${nextField}
      <button class="auth-btn-primary" type="submit">Begin setup</button>
    </form>`;
  return renderAuthDocument({
    step: "Set up two-factor authentication",
    body: renderAuthPage(card, true),
    css: AUTH_PAGE_CSS,
    scripts: authFormSubmitScript(scriptNonce),
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

    if (wrap.dataset.autofocusOtp !== "false") focusDigit(0);
  });
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
