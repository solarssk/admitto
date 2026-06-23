import { describe, expect, it } from "vitest";
import { getBaselineSecurityHeaders } from "../src/security-headers.js";

describe("getBaselineSecurityHeaders", () => {
  it("includes HSTS and nosniff", () => {
    const headers = getBaselineSecurityHeaders();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000");
    expect(headers["Strict-Transport-Security"]).toContain("includeSubDomains");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("same-origin");
  });
});
