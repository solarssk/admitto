import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGeocodingCache,
  InMemoryGeocodingCache,
  RedisGeocodingCache,
} from "../../src/maps/geocoding-cache.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import type { GeocodingResult } from "@admitto/location";

const SAMPLE_RESULTS: GeocodingResult[] = [
  { formatted_address: "Warsaw, Poland", latitude: 52.23, longitude: 21.01, provider: "nominatim" },
];
const unreachableRedis = { connectTimeoutMs: 200 };

describe("InMemoryGeocodingCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null on a miss", async () => {
    const cache = new InMemoryGeocodingCache();
    expect(await cache.get("warsaw")).toBeNull();
  });

  it("round-trips a set result", async () => {
    const cache = new InMemoryGeocodingCache();
    await cache.set("warsaw", SAMPLE_RESULTS);
    expect(await cache.get("warsaw")).toEqual(SAMPLE_RESULTS);
  });

  it("expires a positive (non-empty) result after 30 days", async () => {
    const cache = new InMemoryGeocodingCache();
    await cache.set("warsaw", SAMPLE_RESULTS);

    vi.advanceTimersByTime(29 * 24 * 60 * 60 * 1000);
    expect(await cache.get("warsaw")).toEqual(SAMPLE_RESULTS);

    vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);
    expect(await cache.get("warsaw")).toBeNull();
  });

  it("expires a negative (empty) result after 1 day, sooner than a positive one", async () => {
    const cache = new InMemoryGeocodingCache();
    await cache.set("nowhere", []);

    vi.advanceTimersByTime(23 * 60 * 60 * 1000);
    expect(await cache.get("nowhere")).toEqual([]);

    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(await cache.get("nowhere")).toBeNull();
  });

  it("returns null when a stored value is not valid JSON", async () => {
    const cache = new InMemoryGeocodingCache();
    const store = (cache as unknown as { store: { set: (k: string, v: string, ttl: number) => Promise<void> } })
      .store;
    await store.set("corrupt", "{not-json", 60_000);
    expect(await cache.get("corrupt")).toBeNull();
  });
});

describe("RedisGeocodingCache fail-open", () => {
  beforeEach(() => {
    resetSystemLogBufferForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("get() returns null (a miss, not a throw) when Redis is unreachable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = new RedisGeocodingCache("redis://127.0.0.1:1", unreachableRedis);

    await expect(cache.get("warsaw")).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith("Geocoding cache Redis unavailable; treating as cache miss");

    const entries = querySystemLogs({ source: "cache" });
    expect(
      entries.some(
        (entry) => entry.message === "Geocoding cache Redis unavailable; treating as cache miss",
      ),
    ).toBe(true);

    await cache.disconnect();
  });

  it("set() does not throw when Redis is unreachable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = new RedisGeocodingCache("redis://127.0.0.1:1", unreachableRedis);

    await expect(cache.set("warsaw", SAMPLE_RESULTS)).resolves.toBeUndefined();

    await cache.disconnect();
  });

  it("throttles fail-open warnings during repeated failures", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const cache = new RedisGeocodingCache("redis://127.0.0.1:1", unreachableRedis);

    await cache.get("key-a");
    now += 1_000;
    await cache.get("key-b");
    expect(warnSpy).toHaveBeenCalledTimes(1);

    now += 60_001;
    await cache.get("key-c");
    expect(warnSpy).toHaveBeenCalledTimes(2);

    await cache.disconnect();
  });

  it("does not log the Redis URL's secret on failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = new RedisGeocodingCache("redis://:supersecret@127.0.0.1:1", unreachableRedis);

    await cache.get("warsaw");

    for (const call of warnSpy.mock.calls) {
      expect(String(call[0])).not.toContain("supersecret");
    }

    await cache.disconnect();
  });
});

describe("RedisGeocodingCache", () => {
  it("round-trips positive and negative entries through Redis", async () => {
    const cache = new RedisGeocodingCache(process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379");
    const key = `vitest-geocoding-cache-${crypto.randomUUID()}`;

    try {
      expect(await cache.get(key)).toBeNull();

      await cache.set(key, SAMPLE_RESULTS);
      expect(await cache.get(key)).toEqual(SAMPLE_RESULTS);

      const negativeKey = `${key}-negative`;
      await cache.set(negativeKey, []);
      expect(await cache.get(negativeKey)).toEqual([]);
    } finally {
      await cache.disconnect();
    }
  });
});

describe("createGeocodingCache", () => {
  it("uses in-memory when REDIS_URL is unset", () => {
    expect(createGeocodingCache({})).toBeInstanceOf(InMemoryGeocodingCache);
  });

  it("uses Redis when REDIS_URL is set outside test env", () => {
    const cache = createGeocodingCache({ REDIS_URL: "redis://localhost:6379", NODE_ENV: "production" });
    expect(cache).toBeInstanceOf(RedisGeocodingCache);
  });

  it("uses in-memory in test env even when REDIS_URL is set", () => {
    const cache = createGeocodingCache({ REDIS_URL: "redis://localhost:6379", NODE_ENV: "test" });
    expect(cache).toBeInstanceOf(InMemoryGeocodingCache);
  });
});

describe("RedisGeocodingCache ensureConnected readiness", () => {
  it("fail-opens when connect resolves but the client never becomes ready", async () => {
    vi.resetModules();
    vi.doMock("redis", () => ({
      createClient: () => {
        const client = {
          isReady: false,
          isOpen: false,
          on: vi.fn(),
          connect: vi.fn(async () => undefined),
          quit: vi.fn(async () => undefined),
          withAbortSignal: () => ({
            get: vi.fn(),
            set: vi.fn(),
          }),
        };
        return client;
      },
    }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { RedisGeocodingCache: FreshRedisCache } = await import("../../src/maps/geocoding-cache.js");
    const cache = new FreshRedisCache("redis://127.0.0.1:1", unreachableRedis);
    await expect(cache.get("warsaw")).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    await cache.disconnect();
    warnSpy.mockRestore();
    vi.doUnmock("redis");
    vi.resetModules();
  });
});
