import { describe, expect, it } from "vitest";
import { InvalidHttpUrlError } from "../src/escape.js";
import { resolvePublicBaseUrl } from "../src/baseUrl.js";

describe("resolvePublicBaseUrl", () => {
  it("accepts https BASE_URL and trims trailing slash", () => {
    expect(resolvePublicBaseUrl({ BASE_URL: "https://tickets.example.com/" })).toBe(
      "https://tickets.example.com",
    );
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => resolvePublicBaseUrl({ BASE_URL: "javascript:alert(1)" })).toThrow(
      InvalidHttpUrlError,
    );
  });

  it("falls back to localhost in development", () => {
    expect(resolvePublicBaseUrl({ NODE_ENV: "development" })).toBe("http://localhost:3000");
  });

  it("fails fast outside development when missing", () => {
    expect(() => resolvePublicBaseUrl({ NODE_ENV: "production" })).toThrow(
      "BASE_URL is required in non-development environments",
    );
  });
});
