import { describe, expect, it } from "vitest";
import { resolveBaseUrl, resolveCheckinToken } from "../src/config.js";

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

  it("fails fast in staging when BASE_URL is missing", () => {
    expect(() => resolveBaseUrl({ NODE_ENV: "staging" })).toThrow(
      "BASE_URL is required in non-development environments",
    );
  });
});

describe("resolveCheckinToken", () => {
  it("returns token when CHECKIN_OPERATOR_TOKEN is set", () => {
    expect(resolveCheckinToken({ CHECKIN_OPERATOR_TOKEN: "secret-abc", NODE_ENV: "production" })).toBe("secret-abc");
  });

  it("returns null in development when token is missing", () => {
    expect(resolveCheckinToken({ NODE_ENV: "development" })).toBeNull();
  });

  it("fails fast in production when token is missing", () => {
    expect(() => resolveCheckinToken({ NODE_ENV: "production" })).toThrow(
      "CHECKIN_OPERATOR_TOKEN is required in non-development environments",
    );
  });

  it("fails fast in staging (non-development) when token is missing", () => {
    expect(() => resolveCheckinToken({ NODE_ENV: "staging" })).toThrow(
      "CHECKIN_OPERATOR_TOKEN is required in non-development environments",
    );
  });

  it("fails fast when NODE_ENV is unset (not development)", () => {
    expect(() => resolveCheckinToken({})).toThrow(
      "CHECKIN_OPERATOR_TOKEN is required in non-development environments",
    );
  });
});
