import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@admitto/db";
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

/** A service on the test clock whose provider always answers 20/11 (code 61) and counts its calls. */
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

type WriteArgs = {
  where: { id: string; weather_snapshot: { equals: unknown } };
  data: { weather_snapshot: unknown };
};

/**
 * A stand-in for the two Prisma calls the module makes. `rows` is what is stored, `fail` breaks the
 * read or the write, and `lostRace` makes a write find the stored value already changed.
 */
function fakeDb(
  rows: Array<{ id: string; weather_snapshot: unknown }>,
  fail?: "read" | "write",
  lostRace = false,
) {
  const findMany = vi.fn(async (_args: unknown) => {
    if (fail === "read") throw new Error("db down");
    return rows;
  });
  const updateMany = vi.fn(async (_args: WriteArgs) => {
    if (fail === "write") throw new Error("db down");
    return { count: lostRace ? 0 : 1 };
  });
  return { db: { event: { findMany, updateMany } } as unknown as PrismaClient, findMany, updateMany };
}

beforeEach(() => resetSystemLogBufferForTest());

describe("summarizeEventsWeather", () => {
  it("saves the forecast it just saw for a day that is still ahead, if nothing is saved yet", async () => {
    const { service } = serviceAt(now);
    const { db, updateMany } = fakeDb([]);
    const [summary] = await summarizeEventsWeather(db, service, [tomorrow]);
    expect(summary).toMatchObject({ status: "ok", temp_c: 20, temp_min_c: 11, weather_code: 61 });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "evt-tomorrow", weather_snapshot: { equals: Prisma.DbNull } },
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

  it("replaces a saved forecast only while it is still the one it read", async () => {
    const older = { ...savedForTomorrow, temp_c: 15, temp_min_c: 8 };
    const { service } = serviceAt(now);
    const { db, updateMany } = fakeDb([{ id: "evt-tomorrow", weather_snapshot: older }]);
    await summarizeEventsWeather(db, service, [tomorrow]);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0]![0].where).toEqual({
      id: "evt-tomorrow",
      weather_snapshot: { equals: older },
    });
  });

  it("does not rewrite a forecast that did not change", async () => {
    const { service } = serviceAt(now);
    const { db, updateMany } = fakeDb([{ id: "evt-tomorrow", weather_snapshot: savedForTomorrow }]);
    await summarizeEventsWeather(db, service, [tomorrow]);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("saves a forecast served from the cache too, so every event at the same venue and day keeps one", async () => {
    const { service, providerCalls } = serviceAt(now);
    const { db, updateMany } = fakeDb([]);
    await summarizeEventsWeather(db, service, [tomorrow]);
    await summarizeEventsWeather(db, service, [{ ...tomorrow, id: "evt-tomorrow-2" }]);
    expect(providerCalls).toHaveLength(1);
    expect(updateMany.mock.calls.map((c) => c[0].where.id)).toEqual(["evt-tomorrow", "evt-tomorrow-2"]);
  });

  it("shows the saved forecast of an ended event, without calling the provider or writing anything", async () => {
    const { service, providerCalls } = serviceAt(now);
    const { db, updateMany } = fakeDb([{ id: "evt-ended", weather_snapshot: savedForEnded }]);
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
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("shows only the status for an ended event that never had a forecast saved", async () => {
    const { service } = serviceAt(now);
    const { db, updateMany } = fakeDb([{ id: "evt-ended", weather_snapshot: null }]);
    expect(await summarizeEventsWeather(db, service, [ended])).toEqual([{ status: "past" }]);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("on the event day only fills an empty snapshot", async () => {
    const today: WeatherEventRow = { ...tomorrow, id: "evt-today", date: new Date("2026-08-05T12:00:00.000Z") };
    const filled = fakeDb([{ id: "evt-today", weather_snapshot: { ...savedForTomorrow, date: "2026-08-05", temp_c: 25 } }]);
    await summarizeEventsWeather(filled.db, serviceAt(now).service, [today]);
    expect(filled.updateMany).not.toHaveBeenCalled();

    const empty = fakeDb([]);
    await summarizeEventsWeather(empty.db, serviceAt(now).service, [today]);
    expect(empty.updateMany).toHaveBeenCalledTimes(1);
  });

  it("skips events without a pin: nothing is read, asked or saved for them", async () => {
    const { service, providerCalls } = serviceAt(now);
    const { db, findMany, updateMany } = fakeDb([]);
    const noPin: WeatherEventRow = { id: "evt-nopin", date: tomorrow.date, timezone: "UTC", map_latitude: null, map_longitude: null };
    expect(await summarizeEventsWeather(db, service, [noPin])).toEqual([null]);
    expect(findMany).not.toHaveBeenCalled();
    expect(providerCalls).toEqual([]);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("drops a write that lost the race to another request quietly, without an error", async () => {
    const { service } = serviceAt(now);
    const { db, updateMany } = fakeDb([], undefined, true);
    const [summary] = await summarizeEventsWeather(db, service, [tomorrow]);
    expect(summary?.status).toBe("ok");
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(querySystemLogs({ source: "db" })).toEqual([]);
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

  it("saves nothing, and logs it, when the saved forecasts could not be read", async () => {
    // Without what is stored there is no telling whether a reading may replace it (on the event day
    // it must never overwrite a full-day forecast), so even the event still ahead is not saved.
    const { service } = serviceAt(now);
    const { db, updateMany } = fakeDb([], "read");
    const summaries = await summarizeEventsWeather(db, service, [ended, tomorrow]);
    expect(summaries[0]).toEqual({ status: "past" });
    expect(summaries[1]?.status).toBe("ok");
    expect(updateMany).not.toHaveBeenCalled();
    expect(querySystemLogs({ source: "db" })).toEqual([
      expect.objectContaining({ level: "warn", message: "weather_snapshot_load_failed", fields: { events: 2 } }),
    ]);
  });
});
