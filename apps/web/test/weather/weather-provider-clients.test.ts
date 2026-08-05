import { describe, expect, it, vi } from "vitest";
import { MetNoClient, pickMetNoDailyForecast } from "../../src/weather/met-no-client.js";
import {
  OpenMeteoClient,
  WeatherProviderError,
  pickDailyForecast,
} from "../../src/weather/open-meteo-client.js";
import { defaultWeatherConfig } from "../../src/weather/config.js";

describe("pickDailyForecast", () => {
  it("returns null when a daily cell is null", () => {
    expect(
      pickDailyForecast(
        {
          daily: {
            time: ["2026-08-10"],
            weather_code: [null],
            temperature_2m_max: [22],
            temperature_2m_min: [10],
          },
        },
        "2026-08-10",
      ),
    ).toBeNull();
  });

  it("returns null when arrays are malformed", () => {
    expect(
      pickDailyForecast(
        {
          daily: {
            time: ["2026-08-10"],
            weather_code: [1],
            temperature_2m_max: ["hot" as unknown as number],
            temperature_2m_min: [10],
          },
        },
        "2026-08-10",
      ),
    ).toBeNull();
  });
});

describe("OpenMeteoClient", () => {
  it("fetches a day and attaches the API key query param", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("apikey=secret");
      return new Response(
        JSON.stringify({
          daily: {
            time: ["2026-08-10"],
            weather_code: [2],
            temperature_2m_max: [21.5],
            temperature_2m_min: [12.2],
          },
        }),
        { status: 200 },
      );
    });
    const client = new OpenMeteoClient({
      config: { ...defaultWeatherConfig(), provider: "openmeteo", apiKey: "secret" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(client.fetchDayForecast(52.5, 13.4, "2026-08-10")).resolves.toMatchObject({
      weather_code: 2,
      temp_max_c: 21.5,
    });
  });

  it("maps HTTP failures to WeatherProviderError unavailable", async () => {
    const client = new OpenMeteoClient({
      config: defaultWeatherConfig(),
      fetchFn: async () => new Response("nope", { status: 503 }),
    });
    await expect(client.fetchDayForecast(52.5, 13.4, "2026-08-10")).rejects.toMatchObject({
      kind: "unavailable",
    } satisfies Partial<WeatherProviderError>);
  });

  it("maps AbortError to timeout", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    const client = new OpenMeteoClient({
      config: defaultWeatherConfig(),
      fetchFn: async () => {
        throw err;
      },
    });
    await expect(client.fetchDayForecast(52.5, 13.4, "2026-08-10")).rejects.toMatchObject({
      kind: "timeout",
    });
  });
});

describe("MetNoClient", () => {
  it("sends User-Agent and returns a daily aggregate", async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "User-Agent": "Admitto/test" });
      return new Response(
        JSON.stringify({
          properties: {
            timeseries: [
              {
                time: "2026-08-10T12:00:00Z",
                data: {
                  instant: { details: { air_temperature: 18 } },
                  next_1_hours: { summary: { symbol_code: "clearsky_day" } },
                },
              },
            ],
          },
        }),
        { status: 200 },
      );
    });
    const client = new MetNoClient({
      timeoutMs: 5_000,
      userAgent: "Admitto/test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(
      client.fetchDayForecast(59.91, 10.75, "2026-08-10", "UTC"),
    ).resolves.toMatchObject({
      weather_code: 0,
      temp_max_c: 18,
      temp_min_c: 18,
    });
  });

  it("throws unavailable when the day cannot be aggregated", async () => {
    const client = new MetNoClient({
      timeoutMs: 5_000,
      userAgent: "Admitto/test",
      fetchFn: async () =>
        new Response(JSON.stringify({ properties: { timeseries: [] } }), { status: 200 }),
    });
    await expect(
      client.fetchDayForecast(59.91, 10.75, "2026-08-10", "UTC"),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("pickMetNoDailyForecast returns null without temperatures", () => {
    expect(
      pickMetNoDailyForecast(
        {
          properties: {
            timeseries: [{ time: "2026-08-10T12:00:00Z", data: {} }],
          },
        },
        "2026-08-10",
        "UTC",
      ),
    ).toBeNull();
  });
});
