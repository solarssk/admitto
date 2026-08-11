import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import {
  MAX_CSP_TRUSTED_ORIGINS,
  isValidCspTrustedOrigin,
  validateCspTrustedOrigins,
  sanitizeCspTrustedOrigins,
  getCspTrustedOrigins,
  CspTrustedOriginsError,
} from "../../src/settings/csp-trusted-origins.js";

const envOnlyMockPrisma = {
  systemSettings: { findUnique: async () => null },
} as unknown as PrismaClient;

function settingsMockPrisma(values: Record<string, unknown>): PrismaClient {
  return {
    systemSettings: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        const value = values[where.key];
        return value === undefined ? null : { value_json: JSON.stringify(value) };
      },
    },
  } as unknown as PrismaClient;
}

describe("isValidCspTrustedOrigin", () => {
  it("accepts a bare https origin", () => {
    expect(isValidCspTrustedOrigin("https://static.cloudflareinsights.com")).toBe(true);
    expect(isValidCspTrustedOrigin("https://internal.example.com:8443")).toBe(true);
  });

  it.each([
    ["'self'", "'self'"],
    ["'unsafe-inline'", "'unsafe-inline'"],
    ["'unsafe-eval'", "'unsafe-eval'"],
    ["wildcard", "*"],
    ["wildcard host", "https://*"],
    ["wildcard subdomain", "https://*.example.com"],
    ["partial wildcard subdomain", "https://a*.example.com"],
    ["data:", "data:"],
    ["blob:", "blob:"],
    ["plain http", "http://example.com"],
    ["trailing slash", "https://example.com/"],
    ["path", "https://example.com/beacon.js"],
    ["query string", "https://example.com?x=1"],
    ["fragment", "https://example.com#frag"],
    ["credentials", "https://user:pass@example.com"],
    ["javascript scheme", "javascript:alert(1)"],
    ["malformed https URL", "https://["],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["not a url", "not-a-url"],
  ])("rejects %s", (_label, value) => {
    expect(isValidCspTrustedOrigin(value)).toBe(false);
  });
});

describe("validateCspTrustedOrigins", () => {
  it("returns the normalized array on valid input", () => {
    expect(
      validateCspTrustedOrigins([
        "https://static.cloudflareinsights.com",
        "https://challenges.cloudflare.com",
      ]),
    ).toEqual(["https://static.cloudflareinsights.com", "https://challenges.cloudflare.com"]);
  });

  it("throws for a non-array value", () => {
    expect(() => validateCspTrustedOrigins("https://example.com")).toThrow(CspTrustedOriginsError);
  });

  it("throws when over the max count", () => {
    const tooMany = Array.from({ length: MAX_CSP_TRUSTED_ORIGINS + 1 }, (_, i) => `https://example${i}.com`);
    expect(() => validateCspTrustedOrigins(tooMany)).toThrow(/at most/i);
  });

  it("throws for a non-string entry", () => {
    expect(() => validateCspTrustedOrigins([123])).toThrow(/must be a string/i);
  });

  it("throws for an invalid origin", () => {
    expect(() => validateCspTrustedOrigins(["'self'"])).toThrow(/invalid trusted origin/i);
  });

  it("throws for a duplicate origin", () => {
    expect(() =>
      validateCspTrustedOrigins(["https://example.com", "https://example.com"]),
    ).toThrow(/duplicate/i);
  });
});

describe("sanitizeCspTrustedOrigins", () => {
  it("never throws and returns [] for non-array input", () => {
    expect(sanitizeCspTrustedOrigins(undefined)).toEqual([]);
    expect(sanitizeCspTrustedOrigins(null)).toEqual([]);
    expect(sanitizeCspTrustedOrigins("not-an-array")).toEqual([]);
    expect(sanitizeCspTrustedOrigins(42)).toEqual([]);
  });

  it("drops invalid and duplicate entries, keeping valid ones", () => {
    expect(
      sanitizeCspTrustedOrigins([
        "https://example.com",
        "'self'",
        123,
        "https://example.com",
        "https://other.example.com",
      ]),
    ).toEqual(["https://example.com", "https://other.example.com"]);
  });

  it("caps at MAX_CSP_TRUSTED_ORIGINS", () => {
    const many = Array.from({ length: MAX_CSP_TRUSTED_ORIGINS + 5 }, (_, i) => `https://example${i}.com`);
    expect(sanitizeCspTrustedOrigins(many)).toHaveLength(MAX_CSP_TRUSTED_ORIGINS);
  });
});

describe("getCspTrustedOrigins", () => {
  const prevEnv = process.env.CSP_TRUSTED_ORIGINS;

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CSP_TRUSTED_ORIGINS;
    else process.env.CSP_TRUSTED_ORIGINS = prevEnv;
  });

  it("defaults to [] on a fresh DB", async () => {
    await expect(getCspTrustedOrigins(envOnlyMockPrisma)).resolves.toEqual([]);
  });

  it("reads a persisted array", async () => {
    const prisma = settingsMockPrisma({ csp_trusted_origins: ["https://example.com"] });
    await expect(getCspTrustedOrigins(prisma)).resolves.toEqual(["https://example.com"]);
  });

  it("honors the CSP_TRUSTED_ORIGINS env lock (JSON array)", async () => {
    process.env.CSP_TRUSTED_ORIGINS = '["https://example.com"]';
    await expect(getCspTrustedOrigins(envOnlyMockPrisma)).resolves.toEqual(["https://example.com"]);
  });

  it("falls back to [] for a corrupted persisted value instead of throwing", async () => {
    const prisma = settingsMockPrisma({ csp_trusted_origins: ["'self'", "not-a-url"] });
    await expect(getCspTrustedOrigins(prisma)).resolves.toEqual([]);
  });
});
