import { describe, expect, it } from "vitest";
import { PASSWORD_TOO_COMMON_CODE } from "@admitto/auth";
import { validateSetupForm } from "../../src/setup-routes.js";

describe("validateSetupForm", () => {
  it("rejects a blocklisted password after the minimum length check", () => {
    const result = validateSetupForm({
      email: "admin@example.com",
      password: "aaaaaaaaaaaa",
      confirm_password: "aaaaaaaaaaaa",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(PASSWORD_TOO_COMMON_CODE);
    }
  });
});
