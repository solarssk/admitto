import { describe, expect, it, vi } from "vitest";
import type { GeocodingProvider, GeocodingResult } from "@admitto/location";
import {
  InMemoryGeocodingCache,
} from "../../src/maps/geocoding-cache.js";
import { GeocodingService } from "../../src/maps/geocoding-service.js";

const LATITUDE = 52.3;
const LONGITUDE = 21.05;
const REVERSE_QUERY = "rev:52.300000,21.050000";
const CACHE_SCOPE = "https://geocoding.example.com";

const SEARCH_RESULT: GeocodingResult = {
  formatted_address: "Example city, Synthetic search venue",
  latitude: 52.1,
  longitude: 21.1,
  provider: "nominatim",
};
const REVERSE_RESULT: GeocodingResult = {
  formatted_address: "Example city, Synthetic reverse venue",
  latitude: LATITUDE,
  longitude: LONGITUDE,
  provider: "nominatim",
};

function fakeProvider(searchResults: GeocodingResult[] = [SEARCH_RESULT]) {
  const search = vi.fn(async (_query: string): Promise<GeocodingResult[]> => searchResults);
  const reverse = vi.fn(
    async (_latitude: number, _longitude: number): Promise<GeocodingResult | null> =>
      REVERSE_RESULT,
  );
  const provider: GeocodingProvider = { name: "nominatim", search, reverse };
  return { provider, search, reverse };
}

function recordedCache() {
  const cache = new InMemoryGeocodingCache();
  const set = vi.spyOn(cache, "set");
  return { cache, set };
}

describe("geocoding operation cache isolation", () => {
  it("normalized repeated search remains a cache hit", async () => {
    const { provider, search, reverse } = fakeProvider();
    const service = new GeocodingService(
      provider,
      new InMemoryGeocodingCache(),
      () => CACHE_SCOPE,
    );

    expect(await service.search("  Synthetic   Venue  ")).toEqual([SEARCH_RESULT]);
    expect(await service.search("SYNTHETIC VENUE")).toEqual([SEARCH_RESULT]);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("synthetic venue");
    expect(reverse).not.toHaveBeenCalled();
  });

  it("repeated reverse remains a cache hit", async () => {
    const { provider, search, reverse } = fakeProvider();
    const service = new GeocodingService(
      provider,
      new InMemoryGeocodingCache(),
      () => CACHE_SCOPE,
    );

    expect(await service.reverse(LATITUDE, LONGITUDE)).toEqual(REVERSE_RESULT);
    expect(await service.reverse(LATITUDE, LONGITUDE)).toEqual(REVERSE_RESULT);
    expect(reverse).toHaveBeenCalledTimes(1);
    expect(reverse).toHaveBeenCalledWith(LATITUDE, LONGITUDE);
    expect(search).not.toHaveBeenCalled();
  });

  it("a negative search must not suppress reverse at the same textual key", async () => {
    const { provider, search, reverse } = fakeProvider([]);
    const { cache, set } = recordedCache();
    const service = new GeocodingService(provider, cache, () => CACHE_SCOPE);

    expect(await service.search(REVERSE_QUERY)).toEqual([]);
    const result = await service.reverse(LATITUDE, LONGITUDE);

    expect(
      result,
      "Search's negative entry must not replace the independently available reverse result",
    ).toEqual(REVERSE_RESULT);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith(REVERSE_QUERY);
    expect(reverse).toHaveBeenCalledTimes(1);
    expect(reverse).toHaveBeenCalledWith(LATITUDE, LONGITUDE);
    expect(set).toHaveBeenCalledTimes(2);
  });

  it("a cached reverse must not answer a search with the same text", async () => {
    const { provider, search, reverse } = fakeProvider([]);
    const { cache, set } = recordedCache();
    const service = new GeocodingService(provider, cache, () => CACHE_SCOPE);

    expect(await service.reverse(LATITUDE, LONGITUDE)).toEqual(REVERSE_RESULT);
    const results = await service.search(REVERSE_QUERY);

    expect(
      results,
      "Search must return its own provider's empty result, not the cached reverse result",
    ).toEqual([]);
    expect(reverse).toHaveBeenCalledTimes(1);
    expect(reverse).toHaveBeenCalledWith(LATITUDE, LONGITUDE);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith(REVERSE_QUERY);
    expect(set).toHaveBeenCalledTimes(2);
  });
});


describe("geocoding cache key controls", () => {
  it.each(["search", "reverse"])("keeps positive results independent when %s runs first", async (first) => {
    const { provider, search, reverse } = fakeProvider();
    const service = new GeocodingService(provider, new InMemoryGeocodingCache(), () => CACHE_SCOPE);
    if (first === "search") {
      expect(await service.search(REVERSE_QUERY)).toEqual([SEARCH_RESULT]);
      expect(await service.reverse(LATITUDE, LONGITUDE)).toEqual(REVERSE_RESULT);
    } else {
      expect(await service.reverse(LATITUDE, LONGITUDE)).toEqual(REVERSE_RESULT);
      expect(await service.search(REVERSE_QUERY)).toEqual([SEARCH_RESULT]);
    }
    expect(search).toHaveBeenCalledOnce();
    expect(reverse).toHaveBeenCalledOnce();
  });

  it("keeps reverse misses independent and preserves coordinate rounding", async () => {
    const { provider, search, reverse } = fakeProvider();
    reverse.mockResolvedValue(null);
    const service = new GeocodingService(provider, new InMemoryGeocodingCache(), () => CACHE_SCOPE);
    expect(await service.reverse(LATITUDE, LONGITUDE)).toBeNull();
    expect(await service.reverse(LATITUDE + 0.00000001, LONGITUDE)).toBeNull();
    expect(await service.search(REVERSE_QUERY)).toEqual([SEARCH_RESULT]);
    expect(reverse).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledOnce();
  });

  it("serializes a maximum-length quoted query without field ambiguity and ignores v2 entries", async () => {
    const cache = new InMemoryGeocodingCache();
    await cache.set(`nominatim:v2:${CACHE_SCOPE}:${REVERSE_QUERY}`, [REVERSE_RESULT]);
    const get = vi.spyOn(cache, "get");
    const { provider, search } = fakeProvider();
    const service = new GeocodingService(provider, cache, () => CACHE_SCOPE);
    expect(await service.search(REVERSE_QUERY)).toEqual([SEARCH_RESULT]);
    const query = '"'.repeat(300);
    await service.search(query);
    const key = get.mock.calls.at(-1)![0];
    expect(JSON.parse(key)).toEqual(["nominatim", "v3", CACHE_SCOPE, "search", query]);
    expect(key.length).toBeLessThan(700);
    expect(search).toHaveBeenCalledTimes(2);
  });
});
