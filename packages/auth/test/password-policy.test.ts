import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH } from "../src/constants.js";
import { assertPasswordMeetsPolicy, PasswordPolicyError } from "../src/password-policy.js";

describe("assertPasswordMeetsPolicy", () => {
  it("accepts a password that meets length and blocklist policy", () => {
    expect(() => assertPasswordMeetsPolicy("bootstrap-pass-xyz")).not.toThrow();
  });

  it("rejects passwords shorter than the minimum length", () => {
    expect(() => assertPasswordMeetsPolicy("short")).toThrow(PasswordPolicyError);
    try {
      assertPasswordMeetsPolicy("short");
    } catch (err) {
      expect((err as PasswordPolicyError).code).toBe("password_too_short");
    }
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThan("short".length);
  });

  it("rejects blocklisted and trivially patterned passwords", () => {
    expect(() => assertPasswordMeetsPolicy("aaaaaaaaaaaa")).toThrow(PasswordPolicyError);
    try {
      assertPasswordMeetsPolicy("aaaaaaaaaaaa");
    } catch (err) {
      expect((err as PasswordPolicyError).code).toBe("password_too_common");
    }
  });
});
