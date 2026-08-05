import { describe, expect, it, vi } from "vitest";
import { MetNoClient, metNoSymbolToWeatherCode, pickMetNoDailyForecast } from "../../src/weather/met-no-client.js";
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
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      expect(url).toContain("apikey=secret");
      expect(url).toContain("timezone=Europe%2FWarsaw");
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
    await expect(
      client.fetchDayForecast(52.5, 13.4, "2026-08-10", "Europe/Warsaw"),
    ).resolves.toMatchObject({
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
    const fetchFn = vi.fn(async (_input: string | URL, init?: RequestInit) => {
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

  it("maps remaining MET symbols including unknown fallback", () => {
    expect(metNoSymbolToWeatherCode("fog")).toBe(45);
    expect(metNoSymbolToWeatherCode("lightrainanddrizzle")).toBe(51);
    expect(metNoSymbolToWeatherCode("sleet")).toBe(66);
    expect(metNoSymbolToWeatherCode("snow")).toBe(71);
    expect(metNoSymbolToWeatherCode("rainshower_day")).toBe(80);
    expect(metNoSymbolToWeatherCode("weirdstuff")).toBe(3);
  });

  it("maps TimeoutError and network failures for MET Norway", async () => {
    const timeout = new Error("slow");
    timeout.name = "TimeoutError";
    await expect(
      new MetNoClient({
        timeoutMs: 100,
        userAgent: "Admitto/test",
        fetchFn: async () => {
          throw timeout;
        },
      }).fetchDayForecast(59.91, 10.75, "2026-08-10", "UTC"),
    ).rejects.toMatchObject({ kind: "timeout" });

    await expect(
      new MetNoClient({
        timeoutMs: 100,
        userAgent: "Admitto/test",
        fetchFn: async () => {
          throw new Error("ECONNRESET");
        },
      }).fetchDayForecast(59.91, 10.75, "2026-08-10", "UTC"),
    ).rejects.toMatchObject({ kind: "unavailable" });

    await expect(
      new MetNoClient({
        timeoutMs: 100,
        userAgent: "Admitto/test",
        fetchFn: async () => new Response("no", { status: 403 }),
      }).fetchDayForecast(59.91, 10.75, "2026-08-10", "UTC"),
    ).rejects.toMatchObject({ kind: "unavailable" });

    await expect(
      new MetNoClient({
        timeoutMs: 100,
        userAgent: "Admitto/test",
        fetchFn: async () => new Response("not-json", { status: 200 }),
      }).fetchDayForecast(59.91, 10.75, "2026-08-10", "UTC"),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("probe hits the Oslo pin for today", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          properties: {
            timeseries: [
              {
                time: `${new Date().toISOString().slice(0, 10)}T12:00:00Z`,
                data: {
                  instant: { details: { air_temperature: 12 } },
                  next_1_hours: { summary: { symbol_code: "cloudy" } },
                },
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const client = new MetNoClient({
      timeoutMs: 5_000,
      userAgent: "Admitto/test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await client.probe("UTC");
    expect(String(fetchFn.mock.calls[0]![0])).toContain("lat=59.9100");
    expect(String(fetchFn.mock.calls[0]![0])).toContain("lon=10.7500");
  });
});

describe("OpenMeteoClient extra branches", () => {
  it("maps non-timeout errors and invalid JSON, and probe fetches Berlin", async () => {
    await expect(
      new OpenMeteoClient({
        config: defaultWeatherConfig(),
        fetchFn: async () => {
          throw new Error("boom");
        },
      }).fetchDayForecast(52.5, 13.4, "2026-08-10"),
    ).rejects.toMatchObject({ kind: "unavailable" });

    await expect(
      new OpenMeteoClient({
        config: defaultWeatherConfig(),
        fetchFn: async () => new Response("{", { status: 200 }),
      }).fetchDayForecast(52.5, 13.4, "2026-08-10"),
    ).rejects.toMatchObject({ kind: "unavailable" });

    const fetchFn = vi.fn(async () =>
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
      ),
    );
    await new OpenMeteoClient({
      config: defaultWeatherConfig(),
      fetchFn: fetchFn as unknown as typeof fetch,
    }).probe();
    expect(String(fetchFn.mock.calls[0]![0])).toContain("52.52");
  });
});
