import { describe, expect, it } from "vitest";
import { generateToken } from "../src/token.js";

describe("generateToken", () => {
  it("returns base64url string of expected length", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("returns unique values", () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});
