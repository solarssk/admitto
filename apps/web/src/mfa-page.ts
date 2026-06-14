import { getLoginPageSecurityHeaders } from "./login-page.js";

/** Security headers for server-rendered MFA pages (same policy as login). */
export function getMfaPageSecurityHeaders(): Record<string, string> {
  return getLoginPageSecurityHeaders();
}

/** Render MFA verification form HTML (`/mfa/verify`). */
export function renderMfaVerifyForm(error?: string, next?: string): string {
  const err = error ? `<p class="err">${escapeHtml(error)}</p>` : "";
  const nextField = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Two-factor authentication — Admitto</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 24rem; margin: 3rem auto; padding: 0 1rem; }
    label { display: block; margin: 0.75rem 0 0.25rem; }
    input[type=text] { width: 100%; padding: 0.5rem; box-sizing: border-box; font-size: 1.1rem; letter-spacing: 0.15em; }
    button { margin-top: 1rem; padding: 0.5rem 1rem; }
    .err { color: #b00020; }
    label.check { display: flex; align-items: center; gap: 0.5rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>Two-factor authentication</h1>
  <p>Enter the code from your authenticator app or a backup recovery code.</p>
  ${err}
  <form method="post" action="/mfa/verify">
    ${nextField}
    <label for="code">Authentication code</label>
    <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" required>
    <label class="check"><input type="checkbox" name="remember_device" value="1"> Remember this device</label>
    <button type="submit">Continue</button>
  </form>
</body>
</html>`;
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
  const err = error ? `<p class="err">${escapeHtml(error)}</p>` : "";
  const nextField = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : "";
  const backupSection = backupCodesAlreadyShown
    ? `<div class="warn"><strong>Backup codes</strong> were already shown — use the codes you saved earlier.</div>`
    : `<div class="warn">
    <strong>Backup codes</strong> — save these now; they will not be shown again:
    <ul>${backupCodes.map((c) => `<li><code>${escapeHtml(c)}</code></li>`).join("")}</ul>
  </div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Set up two-factor authentication — Admitto</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 2rem auto; padding: 0 1rem; }
    label { display: block; margin: 0.75rem 0 0.25rem; }
    input[type=text] { width: 100%; padding: 0.5rem; box-sizing: border-box; }
    button { margin-top: 1rem; padding: 0.5rem 1rem; }
    .err { color: #b00020; }
    .warn { background: #fff8e1; padding: 0.75rem; border-radius: 4px; }
    code.uri { word-break: break-all; font-size: 0.75rem; }
  </style>
</head>
<body>
  <h1>Set up two-factor authentication</h1>
  <p>Scan this URI in your authenticator app (or enter the secret manually), then confirm with a code.</p>
  <p><code class="uri">${escapeHtml(otpauthUri)}</code></p>
  ${backupSection}
  ${err}
  <form method="post" action="/mfa/enroll">
    ${nextField}
    <label for="code">Confirmation code</label>
    <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" required>
    <button type="submit">Confirm and continue</button>
  </form>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
