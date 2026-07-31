import { describe, expect, it, vi } from "vitest";
import { GeocodingService } from "../../src/maps/geocoding-service.js";
import type { GeocodingCache } from "../../src/maps/geocoding-cache.js";
import type { GeocodingProvider, GeocodingResult } from "@admitto/location";

const SAMPLE_RESULTS: GeocodingResult[] = [
  { formatted_address: "Warsaw, Poland", latitude: 52.23, longitude: 21.01, provider: "nominatim" },
];

function fakeCache(initial: Record<string, GeocodingResult[]> = {}): GeocodingCache & {
  store: Record<string, GeocodingResult[]>;
} {
  const store = { ...initial };
  return {
    store,
    get: vi.fn(async (key: string): Promise<GeocodingResult[] | null> => store[key] ?? null),
    set: vi.fn(async (key: string, results: GeocodingResult[]) => {
      store[key] = results;
    }),
  };
}

function fakeProvider(results: GeocodingResult[] = SAMPLE_RESULTS): GeocodingProvider & {
  search: ReturnType<typeof vi.fn>;
} {
  return { name: "nominatim", search: vi.fn(async () => results) };
}

describe("GeocodingService", () => {
  it("calls the provider and populates the cache on a miss", async () => {
    const cache = fakeCache();
    const provider = fakeProvider();
    const service = new GeocodingService(provider, cache);

    const results = await service.search("Warsaw");

    expect(results).toEqual(SAMPLE_RESULTS);
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith("nominatim:warsaw", SAMPLE_RESULTS);
  });

  it("returns the cached value without calling the provider on a hit", async () => {
    const cache = fakeCache({ "nominatim:warsaw": SAMPLE_RESULTS });
    const provider = fakeProvider();
    const service = new GeocodingService(provider, cache);

    const results = await service.search("Warsaw");

    expect(results).toEqual(SAMPLE_RESULTS);
    expect(provider.search).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("normalizes whitespace and case so equivalent queries share a cache entry", async () => {
    const cache = fakeCache();
    const provider = fakeProvider();
    const service = new GeocodingService(provider, cache);

    await service.search("  Warsaw  ");
    expect(cache.get).toHaveBeenCalledWith("nominatim:warsaw");
    expect(provider.search).toHaveBeenCalledWith("warsaw");

    await service.search("WARSAW");
    expect(cache.get).toHaveBeenLastCalledWith("nominatim:warsaw");
  });

  it("collapses internal repeated whitespace", async () => {
    const cache = fakeCache();
    const provider = fakeProvider();
    const service = new GeocodingService(provider, cache);

    await service.search("Main   St");
    expect(provider.search).toHaveBeenCalledWith("main st");
  });

  it("scopes the cache key by provider name", async () => {
    const cache = fakeCache();
    const provider: GeocodingProvider = { name: "custom-provider", search: vi.fn(async () => []) };
    const service = new GeocodingService(provider, cache);

    await service.search("Warsaw");
    expect(cache.get).toHaveBeenCalledWith("custom-provider:warsaw");
  });

  it("propagates a provider error instead of swallowing it", async () => {
    const cache = fakeCache();
    const provider: GeocodingProvider = {
      name: "nominatim",
      search: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const service = new GeocodingService(provider, cache);

    await expect(service.search("Warsaw")).rejects.toThrow("boom");
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("caches an empty result array (negative cache)", async () => {
    const cache = fakeCache();
    const provider = fakeProvider([]);
    const service = new GeocodingService(provider, cache);

    const results = await service.search("nowhere");

    expect(results).toEqual([]);
    expect(cache.set).toHaveBeenCalledWith("nominatim:nowhere", []);
  });
});
