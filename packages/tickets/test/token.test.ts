import { describe, expect, it } from "vitest";
import { generateToken } from "../src/token.js";
import { hashToken } from "../src/hash.js";
import { buildTicketUrl, extractTokenFromUrl, looksLikeInternalToken } from "../src/url.js";
import { buildQrPayload } from "../src/qr.js";

describe("generateToken", () => {
  it("produces a ~43-char base64url string (256-bit)", () => {
    const token = generateToken();
    // base64url of 32 bytes = ceil(32*4/3) = 43 chars (no padding)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("produces unique tokens on each call", () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe("hashToken", () => {
  it("produces a 64-char lowercase hex SHA-256 digest", () => {
    expect(hashToken("test")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("different inputs produce different hashes", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("buildTicketUrl", () => {
  it("builds correct URL", () => {
    expect(buildTicketUrl("https://example.com", "TOKEN")).toBe("https://example.com/t/TOKEN");
  });

  it("strips trailing slash from base", () => {
    expect(buildTicketUrl("https://example.com/", "TOKEN")).toBe("https://example.com/t/TOKEN");
  });
});

describe("extractTokenFromUrl", () => {
  it("extracts token from full ticket URL", () => {
    const token = generateToken();
    expect(extractTokenFromUrl(`https://example.com/t/${token}`)).toBe(token);
  });

  it("extracts token when URL has trailing slash or query", () => {
    const token = generateToken();
    expect(extractTokenFromUrl(`https://example.com/t/${token}/`)).toBe(token);
    expect(extractTokenFromUrl(`https://example.com/t/${token}?utm=mail`)).toBe(token);
  });

  it("ignores ticket-like content in a URL query or fragment", () => {
    const pathToken = generateToken();
    const suffixToken = generateToken();

    expect(extractTokenFromUrl(`https://example.com/t/${pathToken}?next=/t/${suffixToken}`))
      .toBe(pathToken);
    expect(extractTokenFromUrl(`https://example.com/t/${pathToken}#/t/${suffixToken}`))
      .toBe(pathToken);
  });

  it("returns null for agency payload (not a URL)", () => {
    expect(extractTokenFromUrl("AGENCY-QR-001")).toBeNull();
  });

  it("returns null for raw token without URL prefix", () => {
    const token = generateToken();
    expect(extractTokenFromUrl(token)).toBeNull();
  });

  it("returns null for a ticket path with an invalid token", () => {
    expect(extractTokenFromUrl("https://example.com/t/not-a-ticket-token")).toBeNull();
  });
});

describe("looksLikeInternalToken", () => {
  it("returns true for a generated token", () => {
    expect(looksLikeInternalToken(generateToken())).toBe(true);
  });

  it("returns false for agency payload", () => {
    expect(looksLikeInternalToken("AGENCY-QR-001")).toBe(false);
  });

  it("returns false for a full URL", () => {
    expect(looksLikeInternalToken(`https://example.com/t/${generateToken()}`)).toBe(false);
  });
});

describe("buildQrPayload", () => {
  it("builds internal QR payload from base URL and token", () => {
    expect(buildQrPayload("internal", { baseUrl: "https://example.com/", token: "TOKEN" }))
      .toBe("https://example.com/t/TOKEN");
  });

  it("returns agency payload verbatim", () => {
    expect(buildQrPayload("agency", { agencyPayload: "AGENCY-QR-001" })).toBe("AGENCY-QR-001");
  });
});
