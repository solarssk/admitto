import { describe, expect, it } from "vitest";
import {
  resolveBaseUrl,
  resolveCheckinToken,
  resolveAllowCheckinBearer,
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

describe("resolveCheckinToken", () => {
  it("returns token when set", () => {
    expect(resolveCheckinToken({ CHECKIN_OPERATOR_TOKEN: "secret-abc" })).toBe("secret-abc");
  });

  it("returns null when missing", () => {
    expect(resolveCheckinToken({})).toBeNull();
  });
});

describe("validateCheckinBootConfig", () => {
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

  it("allows Bearer on with token in non-dev", () => {
    expect(() =>
      validateCheckinBootConfig({
        NODE_ENV: "production",
        ALLOW_CHECKIN_BEARER: "true",
        CHECKIN_OPERATOR_TOKEN: "tok",
      }),
    ).not.toThrow();
  });
});
