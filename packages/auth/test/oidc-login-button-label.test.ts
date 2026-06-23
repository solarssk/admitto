import { describe, expect, it } from "vitest";
import { DEFAULT_SSO_LOGIN_BUTTON_LABEL } from "../src/oidc/constants.js";
import {
  normalizeSsoLoginButtonLabelInput,
  resolveSsoLoginButtonLabel,
} from "../src/oidc/login-button-label.js";

describe("SSO login button label", () => {
  it("uses product default when unset", () => {
    expect(resolveSsoLoginButtonLabel(null)).toBe(DEFAULT_SSO_LOGIN_BUTTON_LABEL);
    expect(resolveSsoLoginButtonLabel(undefined)).toBe(DEFAULT_SSO_LOGIN_BUTTON_LABEL);
    expect(resolveSsoLoginButtonLabel("   ")).toBe(DEFAULT_SSO_LOGIN_BUTTON_LABEL);
  });

  it("uses custom label when set", () => {
    expect(resolveSsoLoginButtonLabel("Continue with Microsoft / Google SSO")).toBe(
      "Continue with Microsoft / Google SSO",
    );
  });

  it("normalizes admin input empty to null", () => {
    expect(normalizeSsoLoginButtonLabelInput("")).toBeNull();
    expect(normalizeSsoLoginButtonLabelInput("  ")).toBeNull();
    expect(normalizeSsoLoginButtonLabelInput("Continue with Authentik")).toBe(
      "Continue with Authentik",
    );
  });
});
