import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  applyAuthPageSecurityHeaders,
  getAuthPageInlineScriptHeaders,
} from "../../src/auth-page-security.js";

describe("auth-page-security", () => {
  it("applies every supplied security header to the response", () => {
    const header = vi.fn();
    const context = { header } as unknown as Context;

    applyAuthPageSecurityHeaders(context, {
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    });

    expect(header).toHaveBeenCalledWith("Content-Security-Policy", "default-src 'none'");
    expect(header).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
  });

  it("uses nonce-gated script-src for inline auth scripts", () => {
    const headers = getAuthPageInlineScriptHeaders("test-nonce-value");
    expect(headers["Content-Security-Policy"]).toContain("script-src 'nonce-test-nonce-value'");
    expect(headers["Content-Security-Policy"]).not.toContain("script-src 'unsafe-inline'");
    expect(headers["Content-Security-Policy"]).toContain("base-uri 'none'");
    expect(headers["Content-Security-Policy"]).toContain("style-src 'unsafe-inline'");
    expect(headers["Content-Security-Policy"]).not.toContain("font-src");
    expect(headers["Content-Security-Policy"]).not.toContain("style-src 'self'");
  });

  it("omitting trustedOrigins stays byte-for-byte identical to the no-args call (regression guard)", () => {
    const withoutArg = getAuthPageInlineScriptHeaders("test-nonce-value");
    const withEmptyArray = getAuthPageInlineScriptHeaders("test-nonce-value", []);
    expect(withEmptyArray["Content-Security-Policy"]).toBe(withoutArg["Content-Security-Policy"]);
    expect(withoutArg["Content-Security-Policy"]).not.toContain("frame-src");
    expect(withoutArg["Content-Security-Policy"]).not.toContain("connect-src");
  });

  it("adds trusted origins to script-src, connect-src, and frame-src (login challenge widget)", () => {
    const headers = getAuthPageInlineScriptHeaders("test-nonce-value", [
      "https://challenges.cloudflare.com",
    ]);
    const csp = headers["Content-Security-Policy"]!;
    expect(csp).toContain("script-src 'nonce-test-nonce-value' https://challenges.cloudflare.com");
    expect(csp).toContain("connect-src https://challenges.cloudflare.com");
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
  });
});
