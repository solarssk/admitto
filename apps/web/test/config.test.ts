import { describe, expect, it } from "vitest";
import {
  resolveBaseUrl,
  resolveCheckinToken,
  resolveAllowCheckinBearer,
  resolveTrustProxy,
  validateCheckinBootConfig,
  validateRedisBootConfig,
  validateEncryptionKeyBootConfig,
  validateTrustedProxyCidrsBootConfig,
} from "../src/config.js";

describe("resolveBaseUrl", () => {
  it("uses explicit BASE_URL and trims trailing slash", () => {
    expect(resolveBaseUrl({ BASE_URL: "https://tickets.example.com/" })).toBe("https://tickets.example.com");
  });

  it("rejects malformed BASE_URL", () => {
    expect(() => resolveBaseUrl({ BASE_URL: "not-a-url" })).toThrow(
      "BASE_URL must be a valid http:// or https:// URL",
    );
  });

  it("falls back to localhost outside production", () => {
    expect(resolveBaseUrl({ NODE_ENV: "development" })).toBe("http://localhost:3000");
  });

  it("fails fast in production when BASE_URL is missing", () => {
    expect(() => resolveBaseUrl({ NODE_ENV: "production" })).toThrow(
      "BASE_URL is required in non-development environments",
    );
  });

  it("rejects http BASE_URL in production (non-localhost)", () => {
    expect(() =>
      resolveBaseUrl({ NODE_ENV: "production", BASE_URL: "http://tickets.example.com" }),
    ).toThrow("BASE_URL must use https:// in non-development environments");
  });

  it("allows http localhost in production for smoke tests", () => {
    expect(resolveBaseUrl({ NODE_ENV: "production", BASE_URL: "http://127.0.0.1:3000" })).toBe(
      "http://127.0.0.1:3000",
    );
  });
});

describe("resolveAllowCheckinBearer", () => {
  it("defaults to false when unset", () => {
    expect(resolveAllowCheckinBearer({})).toBe(false);
  });

  it("parses true and 1", () => {
    expect(resolveAllowCheckinBearer({ ALLOW_CHECKIN_BEARER: "true" })).toBe(true);
    expect(resolveAllowCheckinBearer({ ALLOW_CHECKIN_BEARER: "1" })).toBe(true);
  });
});

describe("resolveTrustProxy", () => {
  it("defaults to false when unset", () => {
    expect(resolveTrustProxy({})).toBe(false);
  });

  it("parses true and 1", () => {
    expect(resolveTrustProxy({ TRUST_PROXY: "true" })).toBe(true);
    expect(resolveTrustProxy({ TRUST_PROXY: "1" })).toBe(true);
  });
});

describe("resolveCheckinToken", () => {
  const validToken = "a".repeat(32);

  it("returns trimmed token when long enough", () => {
    expect(resolveCheckinToken({ CHECKIN_OPERATOR_TOKEN: validToken })).toBe(validToken);
    expect(resolveCheckinToken({ CHECKIN_OPERATOR_TOKEN: `  ${validToken}  ` })).toBe(validToken);
  });

  it("returns null when missing, whitespace-only, or too short", () => {
    expect(resolveCheckinToken({})).toBeNull();
    expect(resolveCheckinToken({ CHECKIN_OPERATOR_TOKEN: "   " })).toBeNull();
    expect(resolveCheckinToken({ CHECKIN_OPERATOR_TOKEN: "short" })).toBeNull();
  });
});

describe("validateCheckinBootConfig", () => {
  const validToken = "b".repeat(32);

  it("allows boot without token when Bearer flag is off", () => {
    expect(() =>
      validateCheckinBootConfig({ NODE_ENV: "production", ALLOW_CHECKIN_BEARER: "" }),
    ).not.toThrow();
  });

  it("throws when Bearer on without token in non-dev", () => {
    expect(() =>
      validateCheckinBootConfig({
        NODE_ENV: "production",
        ALLOW_CHECKIN_BEARER: "true",
        CHECKIN_OPERATOR_TOKEN: "",
      }),
    ).toThrow("CHECKIN_OPERATOR_TOKEN is required when ALLOW_CHECKIN_BEARER=true");
  });

  it("throws when Bearer on with short token in non-dev", () => {
    expect(() =>
      validateCheckinBootConfig({
        NODE_ENV: "production",
        ALLOW_CHECKIN_BEARER: "true",
        CHECKIN_OPERATOR_TOKEN: "tok",
      }),
    ).toThrow("CHECKIN_OPERATOR_TOKEN is required when ALLOW_CHECKIN_BEARER=true");
  });

  it("allows Bearer on with token in non-dev", () => {
    expect(() =>
      validateCheckinBootConfig({
        NODE_ENV: "production",
        ALLOW_CHECKIN_BEARER: "true",
        CHECKIN_OPERATOR_TOKEN: validToken,
      }),
    ).not.toThrow();
  });
});

describe("validateRedisBootConfig", () => {
  it("skips in development and test", () => {
    expect(() => validateRedisBootConfig({ NODE_ENV: "development" })).not.toThrow();
    expect(() => validateRedisBootConfig({ NODE_ENV: "test" })).not.toThrow();
  });

  it("requires authenticated REDIS_URL in production", () => {
    expect(() => validateRedisBootConfig({ NODE_ENV: "production" })).toThrow("REDIS_URL is required");
    expect(() =>
      validateRedisBootConfig({ NODE_ENV: "production", REDIS_URL: "redis://redis:6379" }),
    ).toThrow("password");
    expect(() =>
      validateRedisBootConfig({
        NODE_ENV: "production",
        REDIS_URL: "redis://:short@redis:6379",
      }),
    ).toThrow("password");
    expect(() =>
      validateRedisBootConfig({
        NODE_ENV: "production",
        REDIS_URL: "redis://:smoke-redis-secret@redis:6379",
      }),
    ).not.toThrow();
  });
});

describe("validateTrustedProxyCidrsBootConfig", () => {
  it("allows unset (loopback default)", () => {
    expect(() => validateTrustedProxyCidrsBootConfig({})).not.toThrow();
  });

  it("allows a valid CIDR list", () => {
    expect(() =>
      validateTrustedProxyCidrsBootConfig({ TRUSTED_PROXY_CIDRS: "172.28.238.0/24" }),
    ).not.toThrow();
  });

  it("throws when set but unusable", () => {
    expect(() =>
      validateTrustedProxyCidrsBootConfig({ TRUSTED_PROXY_CIDRS: "not-an-ip" }),
    ).toThrow("TRUSTED_PROXY_CIDRS must contain at least one valid CIDR entry");
  });
});

describe("validateEncryptionKeyBootConfig", () => {
  const validKey = Buffer.alloc(32).toString("base64");

  it("skips in development and test", () => {
    expect(() => validateEncryptionKeyBootConfig({ NODE_ENV: "development" })).not.toThrow();
  });

  it("requires 32-byte base64 key in production", () => {
    expect(() => validateEncryptionKeyBootConfig({ NODE_ENV: "production" })).toThrow(
      "ENCRYPTION_KEY is required",
    );
    expect(() =>
      validateEncryptionKeyBootConfig({ NODE_ENV: "production", ENCRYPTION_KEY: "CHANGE_ME" }),
    ).toThrow("ENCRYPTION_KEY is required");
    expect(() =>
      validateEncryptionKeyBootConfig({
        NODE_ENV: "production",
        ENCRYPTION_KEY: Buffer.alloc(16).toString("base64"),
      }),
    ).toThrow("32 bytes");
    expect(() =>
      validateEncryptionKeyBootConfig({ NODE_ENV: "production", ENCRYPTION_KEY: validKey }),
    ).not.toThrow();
  });
});
