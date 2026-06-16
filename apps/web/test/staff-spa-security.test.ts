import { describe, expect, it } from "vitest";
import { getStaffSpaSecurityHeaders } from "../src/staff-spa.js";

describe("getStaffSpaSecurityHeaders", () => {
  it("includes defense-in-depth headers aligned with other HTML surfaces", () => {
    const headers = getStaffSpaSecurityHeaders();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("script-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("connect-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("font-src 'self' https:");
  });
});
