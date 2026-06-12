import { describe, expect, it, beforeEach } from "vitest";
import { checkRateLimit, _resetRateLimits } from "../src/rate-limit.js";

beforeEach(() => {
  _resetRateLimits();
});

describe("checkRateLimit", () => {
  it("allows requests under the limit", () => {
    for (let i = 0; i < 60; i++) {
      expect(checkRateLimit("1.2.3.4")).toBe(true);
    }
  });

  it("returns false when limit exceeded", () => {
    for (let i = 0; i < 60; i++) {
      checkRateLimit("1.2.3.4");
    }
    expect(checkRateLimit("1.2.3.4")).toBe(false);
  });
});
