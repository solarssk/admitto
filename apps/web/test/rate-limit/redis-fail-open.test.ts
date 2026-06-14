import { afterEach, describe, expect, it, vi } from "vitest";
import { RedisRateLimitStore } from "../../src/rate-limit/redis.js";
import { createRateLimitStore } from "../../src/rate-limit/factory.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const unreachableRedis = { connectTimeoutMs: 200 };

describe("RedisRateLimitStore fail-open", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows traffic when Redis is unreachable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new RedisRateLimitStore("redis://127.0.0.1:1", unreachableRedis);

    const result = await store.hit("1.2.3.4", 60_000, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(60);
    expect(warnSpy).toHaveBeenCalledWith("Rate limit Redis unavailable; failing open");

    await store.disconnect();
  });

  it("throttles fail-open warnings during repeated failures", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new RedisRateLimitStore("redis://127.0.0.1:1", {
      ...unreachableRedis,
      outageCooldownMs: 1,
    });

    await store.hit("1.2.3.4", 60_000, 60);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.hit("1.2.3.4", 60_000, 60);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    await store.disconnect();
  });

  it("skips reconnect during outage cooldown", async () => {
    const store = new RedisRateLimitStore("redis://127.0.0.1:1", {
      connectTimeoutMs: 300,
      outageCooldownMs: 60_000,
    });

    await store.hit("1.2.3.4", 60_000, 60);
    const started = performance.now();
    const result = await store.hit("1.2.3.4", 60_000, 60);
    expect(result.allowed).toBe(true);
    expect(performance.now() - started).toBeLessThan(200);

    await store.disconnect();
  });

  it("rejects invalid timeout options", () => {
    expect(() => new RedisRateLimitStore("redis://localhost", { connectTimeoutMs: 0 })).toThrow(
      "connectTimeoutMs must be a positive number",
    );
    expect(() => new RedisRateLimitStore("redis://localhost", { commandTimeoutMs: -1 })).toThrow(
      "commandTimeoutMs must be a positive number",
    );
  });

  it("does not log Redis URL secrets on failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new RedisRateLimitStore("redis://:supersecret@127.0.0.1:1", unreachableRedis);

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

  it("uses in-memory in test env even when REDIS_URL is set", () => {
    const store = createRateLimitStore({
      REDIS_URL: "redis://localhost:6379",
      NODE_ENV: "test",
    });
    expect(store).toBeInstanceOf(InMemoryRateLimitStore);
  });
});
