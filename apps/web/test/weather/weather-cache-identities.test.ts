import { describe, expect, it, vi } from "vitest";
import { defaultWeatherConfig } from "../../src/weather/config.js";
import {
  InMemoryWeatherCache,
  weatherCacheKey,
  type WeatherCache,
} from "../../src/weather/weather-cache.js";
import {
  eventDateYmd,
  WeatherService,
  type EventWeatherInput,
} from "../../src/weather/weather-service.js";

const LATITUDE = 52.3;
const LONGITUDE = 21.05;
const NOW_ISO = "2026-08-05T12:00:00.000Z";
const EVENT_ISO = "2026-08-08T12:00:00.000Z";

// The outer observations belong to different calendar days in UTC and Europe/Warsaw.
const MET_NO_RESPONSE = {
  properties: {
    timeseries: [
      {
        time: "2026-08-07T23:00:00Z",
        data: {
          instant: { details: { air_temperature: 30 } },
          next_1_hours: { summary: { symbol_code: "cloudy" } },
        },
      },
      {
        time: "2026-08-08T12:00:00Z",
        data: {
          instant: { details: { air_temperature: 10 } },
          next_1_hours: { summary: { symbol_code: "cloudy" } },
        },
      },
      {
        time: "2026-08-08T23:00:00Z",
        data: {
          instant: { details: { air_temperature: 5 } },
          next_1_hours: { summary: { symbol_code: "cloudy" } },
        },
      },
    ],
  },
};

function inputForTimezone(timezone: string): EventWeatherInput {
  return { latitude: LATITUDE, longitude: LONGITUDE, date: EVENT_ISO, timezone };
}

function recordedCache() {
  const cache = new InMemoryWeatherCache();
  const set = vi.spyOn(cache, "set");
  return { cache, set };
}

function weatherHarness(cache: WeatherCache) {
  const fetchFn = vi.fn<typeof fetch>(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://api.met.no");
      expect(url.pathname).toBe("/weatherapi/locationforecast/2.0/compact");
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      return new Response(JSON.stringify(MET_NO_RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  const service = new WeatherService({
    config: defaultWeatherConfig({}),
    cache,
    fetchFn,
    now: () => new Date(NOW_ISO),
    userAgent: "Admitto/test (+https://example.com; weather@example.com)",
    contactConfigured: true,
  });
  return { service, fetchFn };
}

async function independentlyUncachedSummary(timezone: string) {
  const { service, fetchFn } = weatherHarness(new InMemoryWeatherCache());
  const summary = await service.summarize(inputForTimezone(timezone));
  expect(summary?.status).toBe("ok");
  expect(fetchFn).toHaveBeenCalledOnce();
  return summary;
}

describe("daily weather cache timezone identity", () => {
  it.each(["UTC", "Europe/Warsaw"] as const)(
    "repeated %s summaries remain a cache hit",
    async (timezone) => {
      const { service, fetchFn } = weatherHarness(new InMemoryWeatherCache());
      const input = inputForTimezone(timezone);

      const first = await service.summarize(input);
      const second = await service.summarize(input);

      expect(first?.status).toBe("ok");
      expect(second).toEqual(first);
      expect(fetchFn).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { first: "UTC", second: "Europe/Warsaw" },
    { first: "Europe/Warsaw", second: "UTC" },
  ])(
    "$first -> $second cache reuse must match independent uncached summaries",
    async ({ first, second }) => {
      expect(eventDateYmd(EVENT_ISO, first)).toBe(eventDateYmd(EVENT_ISO, second));
      const expectedFirst = await independentlyUncachedSummary(first);
      const expectedSecond = await independentlyUncachedSummary(second);
      expect(expectedFirst).not.toEqual(expectedSecond);

      const { cache, set } = recordedCache();
      const { service, fetchFn } = weatherHarness(cache);
      expect(await service.summarize(inputForTimezone(first))).toEqual(expectedFirst);
      const result = await service.summarize(inputForTimezone(second));

      expect(
        result,
        "A cached daily summary must match the requested timezone's fresh production calculation",
      ).toEqual(expectedSecond);
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(set).toHaveBeenCalledTimes(2);
    },
  );
});


it("ignores timezone-free entries and preserves the configured TTL", async () => {
  const cache = new InMemoryWeatherCache();
  await cache.set("52.30:21.05:2026-08-08:metno:c", {
    date: "2026-08-08", weather_code: 95, temp_max_c: 99, temp_min_c: 99,
  }, 60_000);
  const set = vi.spyOn(cache, "set");
  const { service, fetchFn } = weatherHarness(cache);
  expect(await service.summarize(inputForTimezone("UTC"))).toEqual(await independentlyUncachedSummary("UTC"));
  expect(fetchFn).toHaveBeenCalledOnce();
  expect(set.mock.calls[0]![2]).toBe(defaultWeatherConfig({}).cacheTtlMs);
  const utc = weatherCacheKey(LATITUDE, LONGITUDE, "2026-08-08", "metno", "UTC");
  const warsaw = weatherCacheKey(LATITUDE, LONGITUDE, "2026-08-08", "metno", "Europe/Warsaw");
  expect(utc).not.toBe(warsaw);
  expect(utc.length).toBeLessThan(100);
  expect(JSON.parse(warsaw)).toEqual(["v2", "52.30", "21.05", "2026-08-08", "metno", "Europe/Warsaw", "c"]);
  expect(weatherCacheKey(LATITUDE + 0.0001, LONGITUDE, "2026-08-08", "metno", "UTC")).toBe(utc);
});
