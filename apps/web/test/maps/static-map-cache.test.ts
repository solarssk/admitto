import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStaticMapCache,
  InMemoryStaticMapCache,
  RedisStaticMapCache,
} from "../../src/maps/static-map-cache.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

const unreachableRedis = { connectTimeoutMs: 200 };
const SAMPLE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("InMemoryStaticMapCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null on a miss", async () => {
    const cache = new InMemoryStaticMapCache();
    expect(await cache.get("evt-1")).toBeNull();
  });

  it("round-trips a PNG buffer", async () => {
    const cache = new InMemoryStaticMapCache();
    await cache.set("evt-1", SAMPLE_PNG);
    expect(await cache.get("evt-1")).toEqual(SAMPLE_PNG);
  });

  it("expires after 30 days", async () => {
    const cache = new InMemoryStaticMapCache();
    await cache.set("evt-1", SAMPLE_PNG);

    vi.advanceTimersByTime(29 * 24 * 60 * 60 * 1000);
    expect(await cache.get("evt-1")).toEqual(SAMPLE_PNG);

    vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);
    expect(await cache.get("evt-1")).toBeNull();
  });
});

describe("RedisStaticMapCache fail-open", () => {
  beforeEach(() => {
    resetSystemLogBufferForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("get() returns null when Redis is unreachable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = new RedisStaticMapCache("redis://127.0.0.1:1", unreachableRedis);

    await expect(cache.get("evt-1")).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith("Static map cache Redis unavailable; treating as cache miss");

    const entries = querySystemLogs({ source: "cache" });
    expect(
      entries.some(
        (entry) => entry.message === "Static map cache Redis unavailable; treating as cache miss",
      ),
    ).toBe(true);

    await cache.disconnect();
  });

  it("set() does not throw when Redis is unreachable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = new RedisStaticMapCache("redis://127.0.0.1:1", unreachableRedis);

    await expect(cache.set("evt-1", SAMPLE_PNG)).resolves.toBeUndefined();

    await cache.disconnect();
  });

  it("throttles fail-open warnings during repeated failures", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const cache = new RedisStaticMapCache("redis://127.0.0.1:1", unreachableRedis);

    await cache.get("key-a");
    now += 1_000;
    await cache.get("key-b");
    expect(warnSpy).toHaveBeenCalledTimes(1);

    now += 60_001;
    await cache.get("key-c");
    expect(warnSpy).toHaveBeenCalledTimes(2);

    await cache.disconnect();
  });
});

describe("createStaticMapCache", () => {
  it("uses in-memory when REDIS_URL is unset", () => {
    expect(createStaticMapCache({})).toBeInstanceOf(InMemoryStaticMapCache);
  });

  it("uses Redis when REDIS_URL is set outside test env", () => {
    const cache = createStaticMapCache({
      REDIS_URL: "redis://localhost:6379",
      NODE_ENV: "production",
    });
    expect(cache).toBeInstanceOf(RedisStaticMapCache);
  });

  it("uses in-memory in test env even when REDIS_URL is set", () => {
    const cache = createStaticMapCache({
      REDIS_URL: "redis://localhost:6379",
      NODE_ENV: "test",
    });
    expect(cache).toBeInstanceOf(InMemoryStaticMapCache);
  });
});
