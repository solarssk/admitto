import { describe, expect, it } from "vitest";
import { getAuthPageInlineScriptHeaders } from "../../src/auth-page-security.js";

describe("auth-page-security", () => {
  it("uses nonce-gated script-src for inline auth scripts", () => {
    const headers = getAuthPageInlineScriptHeaders("test-nonce-value");
    expect(headers["Content-Security-Policy"]).toContain("script-src 'nonce-test-nonce-value'");
    expect(headers["Content-Security-Policy"]).not.toContain("script-src 'unsafe-inline'");
    expect(headers["Content-Security-Policy"]).toContain("base-uri 'none'");
  });
});
