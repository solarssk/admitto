import { describe, expect, it } from "vitest";
import {
  getRegistrationPageSecurityHeaders,
  renderRegistrationNotFound,
} from "../src/registration-page-security.js";
import { getTicketPageSecurityHeaders, renderNotFound } from "../src/ticket-page.js";

const NONCE = "bm9uY2UtdmFsdWU=";
const TURNSTILE = "https://challenges.cloudflare.com";

function directive(csp: string, name: string): string | undefined {
  return csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
}

function csp(options: Parameters<typeof getRegistrationPageSecurityHeaders>[1]): string {
  return getRegistrationPageSecurityHeaders(NONCE, options)["Content-Security-Policy"]!;
}

describe("getRegistrationPageSecurityHeaders", () => {
  it("gates scripts on the nonce only, never unsafe-inline or unsafe-eval", () => {
    const policy = csp({ turnstile: false });
    expect(directive(policy, "script-src")).toBe(`script-src 'nonce-${NONCE}'`);
    expect(directive(policy, "script-src")).not.toContain("unsafe");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).toContain("default-src 'none'");
  });

  it("adds Cloudflare to script-src and frame-src only when Turnstile is configured", () => {
    const without = csp({ turnstile: false });
    expect(without).not.toContain("cloudflare");
    expect(directive(without, "frame-src")).toBeUndefined();

    const withKeys = csp({ turnstile: true });
    expect(directive(withKeys, "script-src")).toBe(`script-src 'nonce-${NONCE}' ${TURNSTILE}`);
    expect(directive(withKeys, "frame-src")).toBe(`frame-src ${TURNSTILE}`);
    expect(directive(withKeys, "connect-src")).toBe("connect-src 'self'");
  });

  it("allows the form to post and fetch to itself and nothing to frame it", () => {
    const policy = csp({ turnstile: true });
    expect(directive(policy, "form-action")).toBe("form-action 'self'");
    expect(directive(policy, "connect-src")).toBe("connect-src 'self'");
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'none'");
  });

  it("takes the logo and font origins from the same builders as the ticket page", () => {
    const policy = csp({
      turnstile: false,
      logoUrl: "https://cdn.example.com/logo.png",
      theme: {
        font_family_name: "Brand",
        custom_font_families: [{ name: "Brand", variants: [{ url: "https://fonts.example.com/a.woff2" }] }],
      } as never,
    });
    expect(directive(policy, "img-src")).toBe("img-src 'self' data: https://cdn.example.com");
    expect(directive(policy, "font-src")).toBe("font-src 'self' https://fonts.example.com");
    expect(csp({ turnstile: false, logoUrl: "http://evil.example.com/x.png" })).not.toContain("evil");
  });

  it("sets the response hardening headers", () => {
    const headers = getRegistrationPageSecurityHeaders(NONCE, { turnstile: true });
    expect(headers["Cache-Control"]).toBe("private, no-store, max-age=0");
    expect(headers["Referrer-Policy"]).toBe("same-origin");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow");
    expect(headers["Permissions-Policy"]).toBe(
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    );
  });

  it("sends HSTS only when the request was secure", () => {
    expect(
      getRegistrationPageSecurityHeaders(NONCE, { turnstile: false, secure: true })[
        "Strict-Transport-Security"
      ],
    ).toBe("max-age=31536000; includeSubDomains");
    expect(
      getRegistrationPageSecurityHeaders(NONCE, { turnstile: false, secure: false })[
        "Strict-Transport-Security"
      ],
    ).toBeUndefined();
    expect(
      getRegistrationPageSecurityHeaders(NONCE, { turnstile: false })["Strict-Transport-Security"],
    ).toBeUndefined();
  });

  it("differs from the ticket page, which blocks scripts, fetch and forms", () => {
    const ticket = getTicketPageSecurityHeaders()["Content-Security-Policy"]!;
    expect(ticket).toContain("script-src 'none'");
    expect(csp({ turnstile: false })).not.toContain("script-src 'none'");
  });
});

describe("renderRegistrationNotFound", () => {
  it("is byte for byte the same on every call, so slug and event state cannot be told apart", () => {
    const first = renderRegistrationNotFound(true);
    const second = renderRegistrationNotFound(true);
    expect(second.html).toBe(first.html);
    expect(second.headers).toStrictEqual(first.headers);
    expect(first.status).toBe(404);
  });

  it("is the unthemed 404 with the zero-JS ticket headers", () => {
    const result = renderRegistrationNotFound(false);
    expect(result.html).toBe(renderNotFound(null));
    expect(result.headers).toStrictEqual(getTicketPageSecurityHeaders(null, null, false));
    expect(result.headers["Content-Security-Policy"]).toContain("script-src 'none'");
  });

  it("sends HSTS only over HTTPS", () => {
    expect(renderRegistrationNotFound(true).headers["Strict-Transport-Security"]).toBeDefined();
    expect(renderRegistrationNotFound(false).headers["Strict-Transport-Security"]).toBeUndefined();
  });
});
