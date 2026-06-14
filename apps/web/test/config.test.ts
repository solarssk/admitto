import { describe, expect, it } from "vitest";
import {
  resolveBaseUrl,
  resolveCheckinToken,
  resolveAllowCheckinBearer,
  resolveTrustProxy,
  validateCheckinBootConfig,
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
