import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

describe("InMemoryRateLimitStore", () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
  });

  it("allows requests under the limit", async () => {
    for (let i = 0; i < 60; i++) {
      const result = await store.hit("1.2.3.4", 60_000, 60);
      expect(result.allowed).toBe(true);
    }
  });

  it("returns not allowed when limit exceeded", async () => {
    for (let i = 0; i < 60; i++) {
      await store.hit("1.2.3.4", 60_000, 60);
    }
    const result = await store.hit("1.2.3.4", 60_000, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("prunes expired buckets when a new client arrives", async () => {
    vi.useFakeTimers();
    await store.hit("stale-ip", 60_000, 60);
    expect(store.bucketCount()).toBe(1);
    vi.advanceTimersByTime(61_000);
    await store.hit("fresh-ip", 60_000, 60);
    expect(store.bucketCount()).toBe(1);
    vi.useRealTimers();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
