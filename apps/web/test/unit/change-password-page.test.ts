import { PASSWORD_TOO_COMMON_CODE } from "@admitto/auth";
import { describe, expect, it } from "vitest";
import { renderChangePasswordForm } from "../../src/change-password-page.js";

const SCRIPT_NONCE = "dGVzdC1zY3JpcHQtbm9uY2U=";

describe("change-password-page", () => {
  it("renders the blocklist rejection copy for password_too_common", () => {
    const html = renderChangePasswordForm(SCRIPT_NONCE, PASSWORD_TOO_COMMON_CODE);
    expect(html).toContain("too common or predictable");
    expect(html).toContain('role="alert"');
  });
});
