import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { fetch as undiciFetch } from "undici";
import { MetNoClient, metNoSymbolToWeatherCode, pickMetNoDailyForecast } from "../../src/weather/met-no-client.js";
import {
  OpenMeteoClient,
  WeatherProviderError,
  pickDailyForecast,
} from "../../src/weather/open-meteo-client.js";
import { defaultWeatherConfig } from "../../src/weather/config.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

vi.mock("undici", () => {
  function MockAgent(this: { close: () => Promise<void> }) {
    this.close = vi.fn().mockResolvedValue(undefined);
  }
  return {
    Agent: vi.fn(MockAgent),
    fetch: vi.fn(),
  };
});

const mockedLookup = vi.mocked(lookup);
const mockedUndiciFetch = vi.mocked(undiciFetch);

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

  it("returns null when the date is missing or daily arrays are absent", () => {
    expect(
      pickDailyForecast(
        {
          daily: {
            time: ["2026-08-10"],
            weather_code: [1],
            temperature_2m_max: [20],
            temperature_2m_min: [10],
          },
        },
        "2026-08-11",
      ),
    ).toBeNull();
    expect(pickDailyForecast({ daily: {} }, "2026-08-10")).toBeNull();
    expect(
      pickDailyForecast(
        {
          daily: {
            time: [1 as unknown as string],
            weather_code: [1],
            temperature_2m_max: [20],
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
    const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain("apikey=secret");
      expect(url).toContain("timezone=Europe%2FWarsaw");
      expect(init?.redirect).toBe("error");
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

  it("refuses to follow redirects (SSRF)", async () => {
    const err = new TypeError("fetch failed");
    const fetchFn = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      throw err;
    });
    const client = new OpenMeteoClient({
      config: defaultWeatherConfig(),
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(client.fetchDayForecast(52.5, 13.4, "2026-08-10")).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("rejects http base URL when an API key is configured (before fetch)", async () => {
    const fetchFn = vi.fn(async () => new Response("should not run", { status: 200 }));
    const client = new OpenMeteoClient({
      config: {
        ...defaultWeatherConfig(),
        provider: "openmeteo",
        baseUrl: "http://api.open-meteo.com",
        apiKey: "secret",
      },
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(client.fetchDayForecast(52.5, 13.4, "2026-08-10")).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("allows keyless http base URL", async () => {
    const fetchFn = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      return new Response(
        JSON.stringify({
          daily: {
            time: ["2026-08-10"],
            weather_code: [1],
            temperature_2m_max: [20],
            temperature_2m_min: [10],
          },
        }),
        { status: 200 },
      );
    });
    const client = new OpenMeteoClient({
      config: {
        ...defaultWeatherConfig(),
        provider: "openmeteo",
        baseUrl: "http://api.open-meteo.com",
        apiKey: null,
      },
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(client.fetchDayForecast(52.5, 13.4, "2026-08-10")).resolves.toMatchObject({
      weather_code: 1,
    });
    expect(fetchFn).toHaveBeenCalledOnce();
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

  describe("without a fetchFn override (production DNS pinning)", () => {
    beforeEach(() => {
      mockedLookup.mockClear();
      mockedUndiciFetch.mockClear();
      mockedLookup.mockResolvedValue([{ address: "1.2.3.4", family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>);
      mockedUndiciFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            daily: {
              time: ["2026-08-10"],
              weather_code: [1],
              temperature_2m_max: [20],
              temperature_2m_min: [10],
            },
          }),
          { status: 200 },
        ) as unknown as Awaited<ReturnType<typeof undiciFetch>>,
      );
    });

    it("re-resolves the host and pins the connection instead of calling global fetch", async () => {
      const globalFetch = vi.fn();
      vi.stubGlobal("fetch", globalFetch);
      try {
        const client = new OpenMeteoClient({ config: defaultWeatherConfig() });
        await expect(client.fetchDayForecast(52.5, 13.4, "2026-08-10")).resolves.toMatchObject({
          weather_code: 1,
        });
        expect(mockedLookup).toHaveBeenCalledTimes(1);
        expect(mockedUndiciFetch).toHaveBeenCalledOnce();
        expect(globalFetch).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("maps a blocked/rebound host to unavailable", async () => {
      mockedLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>);
      const client = new OpenMeteoClient({ config: defaultWeatherConfig() });
      await expect(client.fetchDayForecast(52.5, 13.4, "2026-08-10")).rejects.toMatchObject({
        kind: "unavailable",
      });
      expect(mockedUndiciFetch).not.toHaveBeenCalled();
    });

    it("times out (instead of hanging) when DNS resolution stalls past the configured deadline", async () => {
      mockedLookup.mockImplementation(() => new Promise(() => {})); // never resolves
      const client = new OpenMeteoClient({ config: { ...defaultWeatherConfig(), timeoutMs: 20 } });
      await expect(client.fetchDayForecast(52.5, 13.4, "2026-08-10")).rejects.toMatchObject({
        kind: "timeout",
      });
      expect(mockedUndiciFetch).not.toHaveBeenCalled();
    }, 1000);

    it("retries the next validated record after a connect failure", async () => {
      mockedLookup.mockResolvedValue([
        { address: "2001:db8::1", family: 6 },
        { address: "203.0.113.9", family: 4 },
      ] as unknown as Awaited<ReturnType<typeof lookup>>);
      mockedUndiciFetch
        .mockRejectedValueOnce(Object.assign(new Error("fetch failed"), { code: "ENETUNREACH" }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              daily: {
                time: ["2026-08-10"],
                weather_code: [3],
                temperature_2m_max: [15],
                temperature_2m_min: [5],
              },
            }),
            { status: 200 },
          ) as unknown as Awaited<ReturnType<typeof undiciFetch>>,
        );
      const client = new OpenMeteoClient({ config: defaultWeatherConfig() });
      await expect(client.fetchDayForecast(52.5, 13.4, "2026-08-10")).resolves.toMatchObject({
        weather_code: 3,
      });
      expect(mockedUndiciFetch).toHaveBeenCalledTimes(2);
    });
  });
});

describe("MetNoClient", () => {
  it("sends User-Agent and returns a daily aggregate", async () => {
    const fetchFn = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "User-Agent": "Admitto/test" });
      expect(init?.redirect).toBe("error");
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
    const fetchFn = vi.fn(async (_input: string | URL) =>
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

    const fetchFn = vi.fn(async (_input: string | URL) =>
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

  it("omits apikey when none is configured", async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      expect(String(input)).not.toContain("apikey=");
      return new Response(
        JSON.stringify({
          daily: {
            time: ["2026-08-10"],
            weather_code: [1],
            temperature_2m_max: [20],
            temperature_2m_min: [10],
          },
        }),
        { status: 200 },
      );
    });
    await new OpenMeteoClient({
      config: { ...defaultWeatherConfig(), provider: "openmeteo", apiKey: null },
      fetchFn: fetchFn as unknown as typeof fetch,
    }).fetchDayForecast(52.5, 13.4, "2026-08-10");
  });
});

describe("pickMetNoDailyForecast symbol branches", () => {
  it("uses next_6_hours when next_1_hours is missing and median when no midday", () => {
    const day = pickMetNoDailyForecast(
      {
        properties: {
          timeseries: [
            {
              time: "2026-08-10T03:00:00Z",
              data: {
                instant: { details: { air_temperature: 8 } },
                next_6_hours: { summary: { symbol_code: "rain" } },
              },
            },
            {
              time: "2026-08-10T06:00:00Z",
              data: {
                instant: { details: { air_temperature: 10 } },
                next_12_hours: { summary: { symbol_code: "cloudy" } },
              },
            },
            { time: 123 as unknown as string, data: { instant: { details: { air_temperature: 99 } } } },
            {
              time: "2026-08-10T09:00:00Z",
              data: {
                instant: { details: { air_temperature: 12 } },
                next_1_hours: { summary: { symbol_code: "fair_day" } },
              },
            },
          ],
        },
      },
      "2026-08-10",
      "UTC",
    );
    expect(day).toMatchObject({
      date: "2026-08-10",
      temp_min_c: 8,
      temp_max_c: 12,
    });
    expect(day?.weather_code).toEqual(expect.any(Number));
  });

  it("returns null for missing/empty timeseries and uses cloudy fallback without symbols", () => {
    expect(pickMetNoDailyForecast({}, "2026-08-10", "UTC")).toBeNull();
    expect(
      pickMetNoDailyForecast({ properties: { timeseries: "nope" as unknown as [] } }, "2026-08-10", "UTC"),
    ).toBeNull();
    expect(
      pickMetNoDailyForecast({ properties: { timeseries: [] } }, "2026-08-10", "UTC"),
    ).toBeNull();

    const tempsOnly = pickMetNoDailyForecast(
      {
        properties: {
          timeseries: [
            {
              time: "2026-08-10T12:00:00Z",
              data: { instant: { details: { air_temperature: 15 } } },
            },
          ],
        },
      },
      "2026-08-10",
      "UTC",
    );
    expect(tempsOnly).toMatchObject({ weather_code: metNoSymbolToWeatherCode("cloudy"), temp_max_c: 15 });
  });

  it("falls back when localHour Intl formatting fails", () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementationOnce(() => {
      throw new RangeError("invalid");
    });
    try {
      const day = pickMetNoDailyForecast(
        {
          properties: {
            timeseries: [
              {
                time: "2026-08-10T12:00:00Z",
                data: {
                  instant: { details: { air_temperature: 11 } },
                  next_1_hours: { summary: { symbol_code: "cloudy" } },
                },
              },
            ],
          },
        },
        "2026-08-10",
        "UTC",
      );
      expect(day).toMatchObject({ temp_max_c: 11 });
    } finally {
      spy.mockRestore();
    }
  });

  it("ymdInTimezone falls back when Intl rejects the zone", () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new RangeError("invalid time zone");
    });
    try {
      const day = pickMetNoDailyForecast(
        {
          properties: {
            timeseries: [
              {
                time: "2026-08-10T12:00:00Z",
                data: {
                  instant: { details: { air_temperature: 9 } },
                  next_1_hours: { summary: { symbol_code: "cloudy" } },
                },
              },
            ],
          },
        },
        "2026-08-10",
        "Bad/Zone",
      );
      expect(day).toMatchObject({ date: "2026-08-10", temp_min_c: 9 });
    } finally {
      spy.mockRestore();
    }
  });
});
