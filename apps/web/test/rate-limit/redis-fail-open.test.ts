import { afterEach, describe, expect, it, vi } from "vitest";
import { RedisRateLimitStore } from "../../src/rate-limit/redis.js";
import { createRateLimitStore } from "../../src/rate-limit/factory.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

describe("RedisRateLimitStore fail-open", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows traffic when Redis is unreachable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new RedisRateLimitStore("redis://127.0.0.1:1", 200);

    const result = await store.hit("1.2.3.4", 60_000, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(60);
    expect(warnSpy).toHaveBeenCalledWith("Rate limit Redis unavailable; failing open");

    await store.disconnect();
  });

  it("does not log Redis URL secrets on failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new RedisRateLimitStore("redis://:supersecret@127.0.0.1:1", 200);

    await store.hit("1.2.3.4", 60_000, 60);

    for (const call of warnSpy.mock.calls) {
      expect(String(call[0])).not.toContain("supersecret");
    }

    await store.disconnect();
  });
});

describe("createRateLimitStore", () => {
  it("uses in-memory when REDIS_URL is unset", () => {
    const store = createRateLimitStore({});
    expect(store).toBeInstanceOf(InMemoryRateLimitStore);
  });

  it("uses Redis when REDIS_URL is set", () => {
    const store = createRateLimitStore({ REDIS_URL: "redis://localhost:6379" });
    expect(store).toBeInstanceOf(RedisRateLimitStore);
  });
});
