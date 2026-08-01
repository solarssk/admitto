import { describe, expect, it, vi } from "vitest";
import { GeocodingService } from "../../src/maps/geocoding-service.js";
import type { GeocodingCache } from "../../src/maps/geocoding-cache.js";
import type { GeocodingProvider, GeocodingResult } from "@admitto/location";

const SAMPLE_RESULTS: GeocodingResult[] = [
  { formatted_address: "Poland, Warsaw — Centrum", latitude: 52.23, longitude: 21.01, provider: "nominatim" },
];

const SAMPLE_REVERSE: GeocodingResult = {
  name: "Marywilska 62",
  formatted_address: "Polska, Warszawa — Marywilska 62",
  latitude: 52.3,
  longitude: 21.05,
  provider: "nominatim",
};

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

function fakeProvider(
  results: GeocodingResult[] = SAMPLE_RESULTS,
  reverseResult: GeocodingResult | null = SAMPLE_REVERSE,
): GeocodingProvider & {
  search: ReturnType<typeof vi.fn>;
  reverse: ReturnType<typeof vi.fn>;
} {
  return {
    name: "nominatim",
    search: vi.fn(async () => results),
    reverse: vi.fn(async () => reverseResult),
  };
}

describe("GeocodingService.search", () => {
  it("calls the provider and populates the cache on a miss", async () => {
    const cache = fakeCache();
    const provider = fakeProvider();
    const service = new GeocodingService(provider, cache);

    const results = await service.search("Warsaw");

    expect(results).toEqual(SAMPLE_RESULTS);
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith("nominatim:v2:warsaw", SAMPLE_RESULTS);
  });

  it("returns the cached value without calling the provider on a hit", async () => {
    const cache = fakeCache({ "nominatim:v2:warsaw": SAMPLE_RESULTS });
    const provider = fakeProvider();
    const service = new GeocodingService(provider, cache);

    expect(await service.search("Warsaw")).toEqual(SAMPLE_RESULTS);
    expect(provider.search).not.toHaveBeenCalled();
  });

  it("normalizes whitespace and case so equivalent queries share a cache entry", async () => {
    const cache = fakeCache();
    const provider = fakeProvider();
    const service = new GeocodingService(provider, cache);

    await service.search("  Warsaw  ");
    expect(provider.search).toHaveBeenCalledWith("warsaw");
    await service.search("WARSAW");
    expect(cache.get).toHaveBeenLastCalledWith("nominatim:v2:warsaw");
  });

  it("scopes the cache key by provider name", async () => {
    const cache = fakeCache();
    const provider: GeocodingProvider = {
      name: "custom-provider",
      search: vi.fn(async () => []),
      reverse: vi.fn(async () => null),
    };
    const service = new GeocodingService(provider, cache);

    await service.search("Warsaw");
    expect(cache.get).toHaveBeenCalledWith("custom-provider:v2:warsaw");
  });

  it("caches an empty result array (negative cache)", async () => {
    const cache = fakeCache();
    const provider = fakeProvider([]);
    const service = new GeocodingService(provider, cache);

    expect(await service.search("nowhere")).toEqual([]);
    expect(cache.set).toHaveBeenCalledWith("nominatim:v2:nowhere", []);
  });
});

describe("GeocodingService.reverse", () => {
  it("calls the provider and caches a single-result array", async () => {
    const cache = fakeCache();
    const provider = fakeProvider();
    const service = new GeocodingService(provider, cache);

    const result = await service.reverse(52.3, 21.05);

    expect(result).toEqual(SAMPLE_REVERSE);
    expect(provider.reverse).toHaveBeenCalledWith(52.3, 21.05);
    expect(cache.set).toHaveBeenCalledWith("nominatim:v2:rev:52.300000,21.050000", [SAMPLE_REVERSE]);
  });

  it("returns the cached reverse hit without calling the provider", async () => {
    const cache = fakeCache({ "nominatim:v2:rev:52.300000,21.050000": [SAMPLE_REVERSE] });
    const provider = fakeProvider();
    const service = new GeocodingService(provider, cache);

    expect(await service.reverse(52.3, 21.05)).toEqual(SAMPLE_REVERSE);
    expect(provider.reverse).not.toHaveBeenCalled();
  });

  it("negative-caches a miss as an empty array", async () => {
    const cache = fakeCache();
    const provider = fakeProvider(SAMPLE_RESULTS, null);
    const service = new GeocodingService(provider, cache);

    expect(await service.reverse(0, 0)).toBeNull();
    expect(cache.set).toHaveBeenCalledWith("nominatim:v2:rev:0.000000,0.000000", []);
  });
});
