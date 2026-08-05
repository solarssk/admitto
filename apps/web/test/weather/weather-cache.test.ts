import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWeatherCache,
  getSharedWeatherCache,
  InMemoryWeatherCache,
  RedisWeatherCache,
  resetSharedWeatherCacheForTests,
  weatherConfigCacheScope,
} from "../../src/weather/weather-cache.js";
import type { DayForecast } from "../../src/weather/types.js";

const sampleDay: DayForecast = {
  date: "2026-08-10",
  weather_code: 1,
  temp_max_c: 22,
  temp_min_c: 11,
};

describe("WeatherCacheAdapter / InMemoryWeatherCache", () => {
  afterEach(async () => {
    await resetSharedWeatherCacheForTests();
  });

  it("round-trips forecasts and treats corrupt JSON as a miss", async () => {
    const cache = new InMemoryWeatherCache();
    await cache.set("k1", sampleDay, 60_000);
    await expect(cache.get("k1")).resolves.toEqual(sampleDay);

    const store = (
      cache as unknown as { store: { set: (k: string, v: string, ttl: number) => Promise<void> } }
    ).store;
    await store.set("k-bad", "{not-json", 60_000);
    await expect(cache.get("k-bad")).resolves.toBeNull();
  });

  it("createWeatherCache uses Redis when REDIS_URL is set outside test", () => {
    const redis = createWeatherCache({
      NODE_ENV: "production",
      REDIS_URL: " redis://127.0.0.1:6379/15 ",
    });
    expect(redis).toBeInstanceOf(RedisWeatherCache);

    expect(createWeatherCache({ NODE_ENV: "production", REDIS_URL: "   " })).toBeInstanceOf(
      InMemoryWeatherCache,
    );
    expect(createWeatherCache({ NODE_ENV: "production" })).toBeInstanceOf(InMemoryWeatherCache);
  });

  it("resetSharedWeatherCacheForTests disconnects the previous adapter", async () => {
    const shared = getSharedWeatherCache({ NODE_ENV: "test" });
    const spy = vi
      .spyOn(shared as InMemoryWeatherCache, "disconnect")
      .mockResolvedValue(undefined);
    await resetSharedWeatherCacheForTests();
    expect(spy).toHaveBeenCalled();
    expect(getSharedWeatherCache({ NODE_ENV: "test" })).not.toBe(shared);
  });

  it("weatherConfigCacheScope normalises Open-Meteo hosts", () => {
    expect(weatherConfigCacheScope({ provider: "metno", baseUrl: "ignored" })).toBe("metno");
    expect(
      weatherConfigCacheScope({
        provider: "openmeteo",
        baseUrl: "HTTPS://API.Open-Meteo.com/",
      }),
    ).toBe("om:https://api.open-meteo.com");
  });
});
