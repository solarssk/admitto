import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit, _resetRateLimits, _bucketCount } from "../src/rate-limit.js";

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

  it("prunes expired buckets when a new client arrives", () => {
    vi.useFakeTimers();
    checkRateLimit("stale-ip");
    expect(_bucketCount()).toBe(1);
    vi.advanceTimersByTime(61_000);
    checkRateLimit("fresh-ip");
    expect(_bucketCount()).toBe(1);
    vi.useRealTimers();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
