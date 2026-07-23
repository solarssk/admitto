import { describe, expect, it } from "vitest";
import { getLoginPageSecurityHeaders, renderLoginForm } from "../../src/login-page.js";
import {
  getMfaEnrollPageSecurityHeaders,
  getMfaPageSecurityHeaders,
  renderMfaEnrollBackupCodesPage,
  renderMfaEnrollQrPage,
  renderMfaEnrollStartPage,
  renderMfaVerifyForm,
} from "../../src/mfa-page.js";

const NONCE = "unit-test-nonce";

/**
 * Every inline `<script>` tag must carry the response nonce. Counts literal
 * substrings instead of a tag regex — our renderers emit exactly
 * `<script nonce="...">`, and CodeQL flags HTML-tag regexes (js/bad-tag-filter).
 */
function expectAllScriptsNonced(html: string): void {
  const openTags = html.split("<script").length - 1;
  const noncedTags = html.split(`<script nonce="${NONCE}">`).length - 1;
  expect(openTags).toBeGreaterThan(0);
  expect(noncedTags).toBe(openTags);
}

function expectNonceOnlyScriptSrc(headers: Record<string, string>): void {
  const csp = headers["Content-Security-Policy"] ?? "";
  const scriptSrc = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("script-src"));
  expect(scriptSrc).toBe(`script-src 'nonce-${NONCE}'`);
}

describe("auth page inline script nonces (#253)", () => {
  it("login headers use nonce-gated script-src", () => {
    expectNonceOnlyScriptSrc(getLoginPageSecurityHeaders(NONCE));
  });

  it("MFA verify and enroll headers use nonce-gated script-src", () => {
    expectNonceOnlyScriptSrc(getMfaPageSecurityHeaders(NONCE));
    expectNonceOnlyScriptSrc(getMfaEnrollPageSecurityHeaders(NONCE));
  });

  it("login form tags its submit script with the nonce", () => {
    expectAllScriptsNonced(renderLoginForm(NONCE));
  });

  it("MFA verify page tags OTP and submit scripts with the nonce", () => {
    const html = renderMfaVerifyForm(NONCE);
    expectAllScriptsNonced(html);
    expect(html).toContain("data-auth-otp-digits");
  });

  it("MFA enroll QR page tags OTP, copy, and submit scripts with the nonce", () => {
    const html = renderMfaEnrollQrPage({
      scriptNonce: NONCE,
      otpauthUri: "otpauth://totp/Admitto:user@example.com?secret=ABC&issuer=Admitto",
      setupKey: "ABC",
      qrDataUri: "data:image/png;base64,QUJD",
    });
    expectAllScriptsNonced(html);
    // Copy handler is emitted once — a duplicate would double-register listeners.
    expect(html.match(/copy-enroll-secret/g)?.filter((m) => m).length).toBeGreaterThan(0);
    expect(html.match(/getElementById\("copy-enroll-secret"\)/g) ?? []).toHaveLength(1);
  });

  it("MFA enroll start and backup-codes pages tag submit script with the nonce", () => {
    expectAllScriptsNonced(renderMfaEnrollStartPage(NONCE));
    expectAllScriptsNonced(
      renderMfaEnrollBackupCodesPage({ scriptNonce: NONCE, backupCodes: ["AAAA-BBBB"] }),
    );
  });
});
