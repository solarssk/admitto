import { PASSWORD_MIN_LENGTH } from "@admitto/auth";
import { describe, expect, it } from "vitest";
import {
  renderSetupPage,
  setupErrorMessage,
  setupPasswordRulesAttribute,
} from "../../src/setup-page.js";

const SETUP_SCRIPT_NONCE = "dGVzdC1zZXR1cC1ub25jZQ==";

describe("setup-page", () => {
  it("exposes password rules for password managers", () => {
    expect(setupPasswordRulesAttribute()).toBe("minlength: 12;");
  });

  it("renders password manager friendly fields", () => {
    const html = renderSetupPage(undefined, {}, SETUP_SCRIPT_NONCE);
    expect(html).toContain('autocomplete="username"');
    expect(html).toContain('passwordrules="minlength: 12;"');
    expect(html).toContain('autocomplete="new-password"');
    expect(html).toContain('name="confirm_password"');
    expect(html).toContain("at least 12 characters");
    expect(html).toContain("auth-password-strength__bar");
    expect(html).toContain("scorePasswordStrengthInline");
    expect(html).toContain(`nonce="${SETUP_SCRIPT_NONCE}"`);
  });

  it("maps password_too_short to PASSWORD_MIN_LENGTH copy", () => {
    expect(setupErrorMessage("password_too_short")).toBe(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    );
  });

  it("maps email_taken to mockup copy", () => {
    expect(setupErrorMessage("email_taken")).toBe(
      "An account with this email already exists.",
    );
  });

  it("preserves email and display name on validation error", () => {
    const html = renderSetupPage("password_mismatch", {
      email: "admin@example.com",
      display_name: "Ops Lead",
    }, SETUP_SCRIPT_NONCE);
    expect(html).toContain('value="admin@example.com"');
    expect(html).toContain('value="Ops Lead"');
    expect(html).toContain("Passwords do not match.");
  });
});
