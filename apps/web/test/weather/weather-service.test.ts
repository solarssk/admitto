import { describe, expect, it } from "vitest";
import {
  FORECAST_HORIZON_DAYS_METNO,
  FORECAST_HORIZON_DAYS_OPENMETEO,
  InMemoryWeatherCache,
  WeatherService,
  eventDateYmd,
  forecastHorizonDays,
  getWeatherService,
  isOpenMeteoCommercialHost,
  mergeWeatherConfig,
  metNoSymbolToWeatherCode,
  pickDailyForecast,
  pickMetNoDailyForecast,
  resetWeatherServiceForTests,
  resolveWeatherEnvConfig,
  summarizeMany,
  weatherApiKeyRequired,
  weatherCacheKey,
  weatherConfigCacheScope,
  weatherCodeInfo,
} from "../../src/weather/index.js";

describe("isOpenMeteoCommercialHost", () => {
  it("detects the customer API host", () => {
    expect(isOpenMeteoCommercialHost("https://customer-api.open-meteo.com")).toBe(true);
    expect(isOpenMeteoCommercialHost("https://customer-api.open-meteo.com/v1")).toBe(true);
    expect(isOpenMeteoCommercialHost("https://api.open-meteo.com")).toBe(false);
    expect(isOpenMeteoCommercialHost("https://meteo.example.com")).toBe(false);
  });

  it("requires an API key only for Open-Meteo commercial host when enabled", () => {
    expect(
      weatherApiKeyRequired("openmeteo", "https://customer-api.open-meteo.com", true),
    ).toBe(true);
    expect(
      weatherApiKeyRequired("openmeteo", "https://customer-api.open-meteo.com", false),
    ).toBe(false);
    expect(weatherApiKeyRequired("openmeteo", "https://api.open-meteo.com", true)).toBe(false);
    expect(
      weatherApiKeyRequired("metno", "https://customer-api.open-meteo.com", true),
    ).toBe(false);
  });
});

describe("resolveWeatherEnvConfig", () => {
  it("defaults to MET Norway when no Open-Meteo hints", () => {
    const cfg = resolveWeatherEnvConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.provider).toBe("metno");
    expect(cfg.baseUrl).toBe("https://api.open-meteo.com");
    expect(cfg.apiKey).toBeNull();
  });

  it("infers openmeteo when OPEN_METEO_* env is set without WEATHER_PROVIDER", () => {
    const cfg = resolveWeatherEnvConfig({
      OPEN_METEO_BASE_URL: "https://api.open-meteo.com",
      OPEN_METEO_API_KEY: "env-key",
    });
    expect(cfg.provider).toBe("openmeteo");
    expect(cfg.apiKey).toBe("env-key");
  });

  it("honours WEATHER_ENABLED=false", () => {
    expect(resolveWeatherEnvConfig({ WEATHER_ENABLED: "false" }).enabled).toBe(false);
  });

  it("merges UI overrides over env", () => {
    const env = resolveWeatherEnvConfig({
      WEATHER_PROVIDER: "openmeteo",
      OPEN_METEO_BASE_URL: "https://api.open-meteo.com",
      OPEN_METEO_API_KEY: "env-key",
    });
    const merged = mergeWeatherConfig(env, {
      enabled: true,
      provider: "openmeteo",
      baseUrl: "https://customer-api.open-meteo.com",
      apiKey: "ui-key",
    });
    expect(merged.baseUrl).toBe("https://customer-api.open-meteo.com");
    expect(merged.apiKey).toBe("ui-key");
    expect(merged.provider).toBe("openmeteo");
  });
});

describe("pickDailyForecast / weatherCodeInfo / met.no", () => {
  it("picks the matching calendar day", () => {
    const day = pickDailyForecast(
      {
        daily: {
          time: ["2026-08-10", "2026-08-11"],
          weather_code: [0, 61],
          temperature_2m_max: [20, 18],
          temperature_2m_min: [10, 9],
        },
      },
      "2026-08-11",
    );
    expect(day).toEqual({
      date: "2026-08-11",
      weather_code: 61,
      temp_max_c: 18,
      temp_min_c: 9,
    });
  });

  it("maps WMO codes to icons", () => {
    expect(weatherCodeInfo(0).icon).toBe("ti-sun");
    expect(weatherCodeInfo(61).icon).toBe("ti-cloud-rain");
    expect(weatherCodeInfo(95).icon).toBe("ti-cloud-storm");
  });

  it("maps MET Norway symbols to WMO-ish codes", () => {
    expect(metNoSymbolToWeatherCode("clearsky_day")).toBe(0);
    expect(metNoSymbolToWeatherCode("partlycloudy_night")).toBe(2);
    expect(metNoSymbolToWeatherCode("rain")).toBe(61);
    expect(metNoSymbolToWeatherCode("heavyrainandthunder")).toBe(95);
  });

  it("aggregates compact timeseries for a local calendar day", () => {
    const day = pickMetNoDailyForecast(
      {
        properties: {
          timeseries: [
            {
              time: "2026-08-10T10:00:00Z",
              data: {
                instant: { details: { air_temperature: 12 } },
                next_1_hours: { summary: { symbol_code: "cloudy" } },
              },
            },
            {
              time: "2026-08-10T12:00:00Z",
              data: {
                instant: { details: { air_temperature: 18 } },
                next_1_hours: { summary: { symbol_code: "fair_day" } },
              },
            },
            {
              time: "2026-08-11T12:00:00Z",
              data: {
                instant: { details: { air_temperature: 99 } },
                next_1_hours: { summary: { symbol_code: "rain" } },
              },
            },
          ],
        },
      },
      "2026-08-10",
      "UTC",
    );
    expect(day).toEqual({
      date: "2026-08-10",
      weather_code: 1,
      temp_max_c: 18,
      temp_min_c: 12,
    });
  });
});

describe("WeatherService.summarize", () => {
  const pin = { latitude: 52.23, longitude: 21.01, timezone: "Europe/Warsaw" };

  it("returns null when disabled", async () => {
    const service = new WeatherService({
      config: resolveWeatherEnvConfig({ WEATHER_ENABLED: "false" }),
      cache: new InMemoryWeatherCache(),
    });
    const result = await service.summarize({
      ...pin,
      date: "2026-08-10T12:00:00.000Z",
    });
    expect(result).toBeNull();
  });

  it("returns null without coordinates", async () => {
    const service = new WeatherService({
      config: resolveWeatherEnvConfig({ WEATHER_PROVIDER: "openmeteo" }),
      cache: new InMemoryWeatherCache(),
    });
    const result = await service.summarize({
      latitude: null,
      longitude: null,
      date: "2026-08-10T12:00:00.000Z",
      timezone: "UTC",
    });
    expect(result).toBeNull();
  });

  it("returns too_far with opens_in_days beyond the Open-Meteo horizon", async () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    const service = new WeatherService({
      config: resolveWeatherEnvConfig({ WEATHER_PROVIDER: "openmeteo" }),
      cache: new InMemoryWeatherCache(),
      now: () => now,
      fetchFn: async () => {
        throw new Error("should not fetch");
      },
    });
    // 20 days ahead from Aug 5 → Aug 25
    const result = await service.summarize({
      ...pin,
      date: "2026-08-25T12:00:00.000Z",
    });
    expect(result?.status).toBe("too_far");
    expect(result?.opens_in_days).toBe(20 - (FORECAST_HORIZON_DAYS_OPENMETEO - 1));
  });

  it("uses the MET Norway horizon for too_far", async () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    const service = new WeatherService({
      config: resolveWeatherEnvConfig({ WEATHER_PROVIDER: "metno" }),
      cache: new InMemoryWeatherCache(),
      now: () => now,
      userAgent: "Admitto/test (+https://example.com; ops@example.com)",
      contactConfigured: true,
      fetchFn: async () => {
        throw new Error("should not fetch");
      },
    });
    // 12 days ahead → beyond met.no 9-day window
    const result = await service.summarize({
      ...pin,
      date: "2026-08-17T12:00:00.000Z",
    });
    expect(result?.status).toBe("too_far");
    expect(result?.opens_in_days).toBe(12 - (FORECAST_HORIZON_DAYS_METNO - 1));
    expect(result?.horizon_days).toBe(FORECAST_HORIZON_DAYS_METNO);
    expect(forecastHorizonDays("metno")).toBe(9);
  });

  it("skips MET Norway API when Support contact is missing", async () => {
    let calls = 0;
    const service = new WeatherService({
      config: resolveWeatherEnvConfig({ WEATHER_PROVIDER: "metno" }),
      cache: new InMemoryWeatherCache(),
      now: () => new Date("2026-08-05T12:00:00.000Z"),
      contactConfigured: false,
      userAgent: null,
      fetchFn: async () => {
        calls += 1;
        return new Response("nope", { status: 403 });
      },
    });
    const result = await service.summarize({
      ...pin,
      date: "2026-08-08T12:00:00.000Z",
    });
    expect(result?.status).toBe("unavailable");
    expect(calls).toBe(0);
  });

  it("returns ok from Open-Meteo and caches", async () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          daily: {
            time: ["2026-08-10"],
            weather_code: [2],
            temperature_2m_max: [22.4],
            temperature_2m_min: [14.1],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const cache = new InMemoryWeatherCache();
    const service = new WeatherService({
      config: resolveWeatherEnvConfig({ WEATHER_PROVIDER: "openmeteo" }),
      cache,
      now: () => now,
      fetchFn,
    });
    const first = await service.summarize({
      ...pin,
      date: "2026-08-10T12:00:00.000Z",
    });
    expect(first).toMatchObject({
      status: "ok",
      temp_c: 22,
      temp_min_c: 14,
      weather_code: 2,
      attribution: "Weather data by Open-Meteo.com",
    });
    const second = await service.summarize({
      ...pin,
      date: "2026-08-10T12:00:00.000Z",
    });
    expect(second?.status).toBe("ok");
    expect(calls).toBe(1);
  });

  it("returns ok from MET Norway compact JSON", async () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      expect(url).toContain("api.met.no");
      return new Response(
        JSON.stringify({
          properties: {
            timeseries: [
              {
                time: "2026-08-08T12:00:00Z",
                data: {
                  instant: { details: { air_temperature: 21.2 } },
                  next_1_hours: { summary: { symbol_code: "partlycloudy_day" } },
                },
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const service = new WeatherService({
      config: resolveWeatherEnvConfig({ WEATHER_PROVIDER: "metno" }),
      cache: new InMemoryWeatherCache(),
      now: () => now,
      fetchFn,
      userAgent: "Admitto/test (+https://example.com; ops@example.com)",
      contactConfigured: true,
    });
    const result = await service.summarize({
      ...pin,
      date: "2026-08-08T12:00:00.000Z",
      timezone: "UTC",
    });
    expect(result).toMatchObject({
      status: "ok",
      temp_c: 21,
      weather_code: 2,
      attribution: "Weather data by MET Norway",
    });
  });

  it("returns unavailable when provider fails", async () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    const service = new WeatherService({
      config: resolveWeatherEnvConfig({ WEATHER_PROVIDER: "openmeteo" }),
      cache: new InMemoryWeatherCache(),
      now: () => now,
      fetchFn: async () => new Response("nope", { status: 502 }),
    });
    const result = await service.summarize({
      ...pin,
      date: "2026-08-08T12:00:00.000Z",
    });
    expect(result?.status).toBe("unavailable");
  });

  it("returns unavailable for invalid event dates and far-past days", async () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    const service = new WeatherService({
      config: resolveWeatherEnvConfig({ WEATHER_PROVIDER: "openmeteo" }),
      cache: new InMemoryWeatherCache(),
      now: () => now,
      fetchFn: async () => {
        throw new Error("should not fetch");
      },
    });
    expect(
      (await service.summarize({ ...pin, date: "not-a-date" }))?.status,
    ).toBe("unavailable");
    expect(
      (await service.summarize({ ...pin, date: "2026-08-01T12:00:00.000Z" }))?.status,
    ).toBe("unavailable");
  });

  it("probeLive succeeds for Open-Meteo and requires Support contact for MET Norway", async () => {
    const okFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          daily: {
            time: [new Date().toISOString().slice(0, 10)],
            weather_code: [1],
            temperature_2m_max: [20],
            temperature_2m_min: [10],
          },
        }),
        { status: 200 },
      );
    const openmeteo = new WeatherService({
      config: resolveWeatherEnvConfig({ WEATHER_PROVIDER: "openmeteo" }),
      cache: new InMemoryWeatherCache(),
      fetchFn: okFetch,
    });
    await expect(openmeteo.probeLive()).resolves.toMatchObject({ ok: true });

    const metno = new WeatherService({
      config: resolveWeatherEnvConfig({ WEATHER_PROVIDER: "metno" }),
      cache: new InMemoryWeatherCache(),
      contactConfigured: false,
      userAgent: null,
      fetchFn: async () => new Response("no", { status: 403 }),
    });
    await expect(metno.probeLive()).resolves.toMatchObject({
      ok: false,
      error: "support_contact_required",
    });
  });

  it("probeLive maps WeatherProviderError kinds", async () => {
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    const service = new WeatherService({
      config: resolveWeatherEnvConfig({ WEATHER_PROVIDER: "openmeteo" }),
      cache: new InMemoryWeatherCache(),
      fetchFn: async () => {
        throw timeout;
      },
    });
    await expect(service.probeLive()).resolves.toMatchObject({
      ok: false,
      error: "timeout",
    });
  });

  it("summarizeMany preserves order under concurrency", async () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    const service = new WeatherService({
      config: resolveWeatherEnvConfig({ WEATHER_PROVIDER: "openmeteo" }),
      cache: new InMemoryWeatherCache(),
      now: () => now,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            daily: {
              time: ["2026-08-08"],
              weather_code: [2],
              temperature_2m_max: [18],
              temperature_2m_min: [9],
            },
          }),
          { status: 200 },
        ),
    });
    const results = await summarizeMany(
      [
        { ...pin, date: "2026-08-08T12:00:00.000Z" },
        { latitude: null, longitude: null, date: "2026-08-08T12:00:00.000Z", timezone: "UTC" },
        { ...pin, date: "2026-09-01T12:00:00.000Z" },
      ],
      service,
      2,
    );
    expect(results[0]?.status).toBe("ok");
    expect(results[1]).toBeNull();
    expect(results[2]?.status).toBe("too_far");
  });

  it("getWeatherService reuses a singleton until reset", () => {
    resetWeatherServiceForTests();
    const a = getWeatherService();
    const b = getWeatherService();
    expect(a).toBe(b);
    resetWeatherServiceForTests();
  });
});

describe("helpers", () => {
  it("formats event date in timezone", () => {
    // Evening UTC may still be previous calendar day in US zones; use noon UTC.
    expect(eventDateYmd("2026-08-10T12:00:00.000Z", "UTC")).toBe("2026-08-10");
  });

  it("builds stable cache keys scoped by provider and host", () => {
    expect(weatherCacheKey(52.2297, 21.0122, "2026-08-10", "metno")).toBe(
      "52.23:21.01:2026-08-10:metno:c",
    );
    expect(
      weatherCacheKey(
        52.2297,
        21.0122,
        "2026-08-10",
        weatherConfigCacheScope({
          provider: "openmeteo",
          baseUrl: "https://api.open-meteo.com",
        }),
      ),
    ).toBe("52.23:21.01:2026-08-10:om:https://api.open-meteo.com:c");
    expect(
      weatherConfigCacheScope({
        provider: "openmeteo",
        baseUrl: "https://customer-api.open-meteo.com/",
      }),
    ).toBe("om:https://customer-api.open-meteo.com");
  });
});
