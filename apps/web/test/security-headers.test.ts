import { describe, expect, it } from "vitest";
import { getBaselineSecurityHeaders } from "../src/security-headers.js";
import { getTicketPageSecurityHeaders } from "../src/ticket-page.js";
import { getStaffSpaSecurityHeaders } from "../src/staff-spa.js";
import { getAuthPageInlineScriptHeaders } from "../src/auth-page-security.js";

const HSTS_VALUE = "max-age=31536000; includeSubDomains";

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

// The public ticket page, the staff SPA shell, and every auth HTML page only ever get HSTS from
// the bundled nginx layer in the default (nginx-fronted) topology - deploy/README.md's documented
// "Portainer/NAS without compose nginx" variant skips that layer entirely, so each of these three
// builders must send it directly, gated on the same `isSecureRequest`-style scheme detection used
// for the session cookie's Secure flag (local HTTP dev/bootstrap must stay unaffected).
describe("HSTS on non-baseline HTML security headers", () => {
  it("getTicketPageSecurityHeaders sends HSTS only when the request was secure", () => {
    expect(getTicketPageSecurityHeaders(null, null, true)["Strict-Transport-Security"]).toBe(
      HSTS_VALUE,
    );
    expect(getTicketPageSecurityHeaders(null, null, false)["Strict-Transport-Security"]).toBeUndefined();
    expect(getTicketPageSecurityHeaders()["Strict-Transport-Security"]).toBeUndefined();
  });

  it("getStaffSpaSecurityHeaders sends HSTS only when the request was secure", () => {
    expect(getStaffSpaSecurityHeaders(process.env, [], true)["Strict-Transport-Security"]).toBe(
      HSTS_VALUE,
    );
    expect(
      getStaffSpaSecurityHeaders(process.env, [], false)["Strict-Transport-Security"],
    ).toBeUndefined();
    expect(getStaffSpaSecurityHeaders()["Strict-Transport-Security"]).toBeUndefined();
  });

  it("getAuthPageInlineScriptHeaders sends HSTS only when the request was secure", () => {
    expect(getAuthPageInlineScriptHeaders("nonce", [], true)["Strict-Transport-Security"]).toBe(
      HSTS_VALUE,
    );
    expect(
      getAuthPageInlineScriptHeaders("nonce", [], false)["Strict-Transport-Security"],
    ).toBeUndefined();
    expect(getAuthPageInlineScriptHeaders("nonce")["Strict-Transport-Security"]).toBeUndefined();
  });
});

describe("Permissions-Policy on HTML security headers", () => {
  it("ticket page and auth pages deny every powerful feature", () => {
    expect(getTicketPageSecurityHeaders()["Permissions-Policy"]).toBe(
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    );
    expect(getAuthPageInlineScriptHeaders("nonce")["Permissions-Policy"]).toBe(
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    );
  });

  it("staff SPA allows same-origin camera for QR scanning, denies the rest", () => {
    expect(getStaffSpaSecurityHeaders()["Permissions-Policy"]).toBe(
      "camera=(self), geolocation=(), microphone=(), payment=(), usb=()",
    );
  });
});
