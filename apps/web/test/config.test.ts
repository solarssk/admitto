import { describe, expect, it } from "vitest";
import { resolveBaseUrl } from "../src/config.js";

describe("resolveBaseUrl", () => {
  it("uses explicit BASE_URL and trims trailing slash", () => {
    expect(resolveBaseUrl({ BASE_URL: "https://tickets.example.com/" })).toBe("https://tickets.example.com");
  });

  it("falls back to localhost outside production", () => {
    expect(resolveBaseUrl({ NODE_ENV: "development" })).toBe("http://localhost:3000");
  });

  it("fails fast in production when BASE_URL is missing", () => {
    expect(() => resolveBaseUrl({ NODE_ENV: "production" })).toThrow(
      "BASE_URL environment variable is required in production",
    );
  });
});
