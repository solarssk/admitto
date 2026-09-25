import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import {
  InMemoryWeatherCache,
  WeatherService,
  resolveWeatherEnvConfig,
} from "../../src/weather/index.js";
import { summarizeEventsWeather, type WeatherEventRow } from "../../src/weather/event-weather.js";
import { openMeteoForecastResponse } from "../helpers/open-meteo-forecast.js";

const now = new Date("2026-08-05T12:00:00.000Z");
const pin = { map_latitude: 52.23, map_longitude: 21.01 };
const tomorrow: WeatherEventRow = {
  id: "evt-tomorrow",
  date: new Date("2026-08-06T12:00:00.000Z"),
  timezone: "Europe/Warsaw",
  ...pin,
};
const ended: WeatherEventRow = {
  id: "evt-ended",
  date: new Date("2026-08-01T12:00:00.000Z"),
  timezone: "Europe/Warsaw",
  ...pin,
};

/** What the last look at 6 Aug (forecast for tomorrow) would have saved. */
const savedForTomorrow = {
  v: 1,
  date: "2026-08-06",
  lat: 52.23,
  lon: 21.01,
  provider: "openmeteo",
  temp_c: 20,
  temp_min_c: 11,
  weather_code: 61,
  captured_at: "2026-08-05T09:00:00.000Z",
};
const savedForEnded = { ...savedForTomorrow, date: "2026-08-01", temp_c: 17, temp_min_c: 9, weather_code: 3 };

function serviceAt(at: Date) {
  const providerCalls: string[] = [];
  const service = new WeatherService({
    config: resolveWeatherEnvConfig({ WEATHER_PROVIDER: "openmeteo" }),
    cache: new InMemoryWeatherCache(),
    now: () => at,
    fetchFn: async (input: string | URL | Request) => {
      providerCalls.push(String(input));
      return openMeteoForecastResponse(now);
    },
  });
  return { service, providerCalls };
}

/** A stand-in for the two Prisma calls the module makes. */
function fakeDb(rows: Array<{ id: string; weather_snapshot: unknown }>, fail?: "read" | "write") {
  const findMany = vi.fn(async (_args: unknown) => {
    if (fail === "read") throw new Error("db down");
    return rows;
  });
  const update = vi.fn(
    async (_args: { where: { id: string }; data: { weather_snapshot: unknown } }) => {
      if (fail === "write") throw new Error("db down");
      return {};
    },
  );
  return { db: { event: { findMany, update } } as unknown as PrismaClient, findMany, update };
}

beforeEach(() => resetSystemLogBufferForTest());

describe("summarizeEventsWeather", () => {
  it("saves the forecast it just saw for a day that is still ahead", async () => {
    const { service } = serviceAt(now);
    const { db, update } = fakeDb([]);
    const [summary] = await summarizeEventsWeather(db, service, [tomorrow]);
    expect(summary).toMatchObject({ status: "ok", temp_c: 20, temp_min_c: 11, weather_code: 61 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "evt-tomorrow" },
      data: {
        weather_snapshot: expect.objectContaining({
          v: 1,
          date: "2026-08-06",
          lat: 52.23,
          lon: 21.01,
          provider: "openmeteo",
          temp_c: 20,
          temp_min_c: 11,
          weather_code: 61,
        }),
      },
    });
  });

  it("does not rewrite a forecast that did not change", async () => {
    const { service } = serviceAt(now);
    const { db, update } = fakeDb([{ id: "evt-tomorrow", weather_snapshot: savedForTomorrow }]);
    await summarizeEventsWeather(db, service, [tomorrow]);
    expect(update).not.toHaveBeenCalled();
  });

  it("saves a forecast served from the cache too, so every event at the same venue and day keeps one", async () => {
    const { service, providerCalls } = serviceAt(now);
    const { db, update } = fakeDb([]);
    await summarizeEventsWeather(db, service, [tomorrow]);
    await summarizeEventsWeather(db, service, [{ ...tomorrow, id: "evt-tomorrow-2" }]);
    expect(providerCalls).toHaveLength(1);
    expect(update.mock.calls.map((c) => c[0].where.id)).toEqual(["evt-tomorrow", "evt-tomorrow-2"]);
  });

  it("shows the saved forecast of an ended event, without calling the provider or writing anything", async () => {
    const { service, providerCalls } = serviceAt(now);
    const { db, update } = fakeDb([{ id: "evt-ended", weather_snapshot: savedForEnded }]);
    const [summary] = await summarizeEventsWeather(db, service, [ended]);
    expect(summary).toEqual({
      status: "past",
      temp_c: 17,
      temp_min_c: 9,
      weather_code: 3,
      attribution: "Weather data by Open-Meteo.com",
      attribution_url: "https://open-meteo.com/",
    });
    expect(providerCalls).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });

  it("shows only the status for an ended event that never had a forecast saved", async () => {
    const { service } = serviceAt(now);
    const { db, update } = fakeDb([{ id: "evt-ended", weather_snapshot: null }]);
    expect(await summarizeEventsWeather(db, service, [ended])).toEqual([{ status: "past" }]);
    expect(update).not.toHaveBeenCalled();
  });

  it("on the event day only fills an empty snapshot", async () => {
    const today: WeatherEventRow = { ...tomorrow, id: "evt-today", date: new Date("2026-08-05T12:00:00.000Z") };
    const filled = fakeDb([{ id: "evt-today", weather_snapshot: { ...savedForTomorrow, date: "2026-08-05", temp_c: 25 } }]);
    await summarizeEventsWeather(filled.db, serviceAt(now).service, [today]);
    expect(filled.update).not.toHaveBeenCalled();

    const empty = fakeDb([]);
    await summarizeEventsWeather(empty.db, serviceAt(now).service, [today]);
    expect(empty.update).toHaveBeenCalledTimes(1);
  });

  it("skips events without a pin: nothing is read, asked or saved for them", async () => {
    const { service, providerCalls } = serviceAt(now);
    const { db, findMany, update } = fakeDb([]);
    const noPin: WeatherEventRow = { id: "evt-nopin", date: tomorrow.date, timezone: "UTC", map_latitude: null, map_longitude: null };
    expect(await summarizeEventsWeather(db, service, [noPin])).toEqual([null]);
    expect(findMany).not.toHaveBeenCalled();
    expect(providerCalls).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });

  it("still returns the summaries, and logs it, when saving fails", async () => {
    const { service } = serviceAt(now);
    const { db } = fakeDb([], "write");
    const [summary] = await summarizeEventsWeather(db, service, [tomorrow]);
    expect(summary?.status).toBe("ok");
    expect(querySystemLogs({ source: "db" })).toEqual([
      expect.objectContaining({ level: "warn", message: "weather_snapshot_save_failed", fields: { failed: 1 } }),
    ]);
  });

  it("still returns the summaries, and logs it, when reading the saved forecasts fails", async () => {
    const { service } = serviceAt(now);
    const { db } = fakeDb([], "read");
    // The ended event just shows no chip; the one that is still ahead is unaffected.
    const summaries = await summarizeEventsWeather(db, service, [ended, tomorrow]);
    expect(summaries[0]).toEqual({ status: "past" });
    expect(summaries[1]?.status).toBe("ok");
    expect(querySystemLogs({ source: "db" })).toEqual([
      expect.objectContaining({ level: "warn", message: "weather_snapshot_load_failed", fields: { events: 2 } }),
    ]);
  });
});
