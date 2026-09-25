import { describe, expect, it } from "vitest";
import {
  nextWeatherSnapshot,
  parseWeatherSnapshot,
  snapshotForEvent,
  type SnapshotDecisionInput,
  type WeatherSnapshot,
} from "../../src/weather/weather-snapshot.js";
import type { WeatherSummaryDto } from "../../src/weather/types.js";

const stored: WeatherSnapshot = {
  v: 1,
  date: "2026-08-04",
  lat: 52.23,
  lon: 21.01,
  provider: "metno",
  temp_c: 20,
  temp_min_c: 11,
  weather_code: 61,
  captured_at: "2026-08-03T10:00:00.000Z",
};

describe("parseWeatherSnapshot", () => {
  it("accepts what was stored, including after a JSON round trip", () => {
    expect(parseWeatherSnapshot(stored)).toEqual(stored);
    expect(parseWeatherSnapshot(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it("rejects anything that is not a snapshot this code wrote", () => {
    const bad: unknown[] = [
      null,
      undefined,
      "snapshot",
      42,
      [],
      {},
      { ...stored, v: 2 },
      { ...stored, date: "4 Aug 2026" },
      { ...stored, date: 20260804 },
      { ...stored, provider: "weatherbit" },
      { ...stored, captured_at: undefined },
      { ...stored, temp_c: "20" },
      { ...stored, temp_min_c: Number.NaN },
      { ...stored, weather_code: Number.POSITIVE_INFINITY },
      { ...stored, lat: null },
    ];
    for (const raw of bad) expect(parseWeatherSnapshot(raw)).toBeNull();
  });
});

describe("snapshotForEvent", () => {
  const at = { latitude: 52.2297, longitude: 21.0122, eventYmd: "2026-08-04" };

  it("returns the snapshot while it still fits the event's day and pin (pin rounded to 2 decimals)", () => {
    expect(snapshotForEvent(stored, at)).toEqual(stored);
  });

  it("drops it once the event moved to another day or another place", () => {
    expect(snapshotForEvent(stored, { ...at, eventYmd: "2026-08-05" })).toBeNull();
    expect(snapshotForEvent(stored, { ...at, latitude: 48.8566 })).toBeNull();
    expect(snapshotForEvent(stored, { ...at, longitude: 2.3522 })).toBeNull();
  });

  it("returns null for a missing or unreadable value", () => {
    expect(snapshotForEvent(null, at)).toBeNull();
    expect(snapshotForEvent({ v: 1 }, at)).toBeNull();
  });
});

describe("nextWeatherSnapshot", () => {
  const now = new Date("2026-08-03T18:00:00.000Z");
  const okSummary: WeatherSummaryDto = {
    status: "ok",
    temp_c: 22,
    temp_min_c: 13,
    weather_code: 3,
    attribution: "Weather data by MET Norway",
  };
  const base: SnapshotDecisionInput = {
    current: null,
    summary: okSummary,
    provider: "metno",
    latitude: 52.2297,
    longitude: 21.0122,
    eventYmd: "2026-08-04",
    offsetDays: 1,
    now,
  };

  it("saves a forecast for a day that is still ahead, with the pin rounded and the provider noted", () => {
    expect(nextWeatherSnapshot(base)).toEqual({
      v: 1,
      date: "2026-08-04",
      lat: 52.23,
      lon: 21.01,
      provider: "metno",
      temp_c: 22,
      temp_min_c: 13,
      weather_code: 3,
      captured_at: "2026-08-03T18:00:00.000Z",
    });
  });

  it("replaces a stored forecast with the newer one while the day is still ahead", () => {
    expect(nextWeatherSnapshot({ ...base, current: stored, offsetDays: 3 })).toMatchObject({
      temp_c: 22,
      weather_code: 3,
    });
  });

  it("does not rewrite values that did not change", () => {
    const same = { ...okSummary, temp_c: stored.temp_c, temp_min_c: stored.temp_min_c, weather_code: stored.weather_code };
    expect(nextWeatherSnapshot({ ...base, current: stored, summary: same })).toBeNull();
  });

  it("saves again when only the provider changed", () => {
    const same = { ...okSummary, temp_c: stored.temp_c, temp_min_c: stored.temp_min_c, weather_code: stored.weather_code };
    expect(nextWeatherSnapshot({ ...base, current: stored, summary: same, provider: "openmeteo" })).toMatchObject({
      provider: "openmeteo",
    });
  });

  it("on the event day only fills an empty snapshot and never overwrites a full-day one", () => {
    // MET Norway returns just the hours that are left today, so this reading may be partial.
    expect(nextWeatherSnapshot({ ...base, offsetDays: 0 })).not.toBeNull();
    expect(nextWeatherSnapshot({ ...base, offsetDays: 0, current: stored })).toBeNull();
  });

  it("saves nothing once the day is over", () => {
    expect(nextWeatherSnapshot({ ...base, offsetDays: -1 })).toBeNull();
  });

  it("saves nothing unless a real forecast was seen", () => {
    const notForecasts: Array<WeatherSummaryDto | null> = [
      null,
      { status: "too_far", horizon_days: 9 },
      { status: "unavailable" },
      { status: "past" },
      { status: "past", temp_c: 20, temp_min_c: 11, weather_code: 61 },
      { status: "ok", temp_c: 20 },
      { status: "ok", temp_c: 20, temp_min_c: 11 },
    ];
    for (const summary of notForecasts) expect(nextWeatherSnapshot({ ...base, summary })).toBeNull();
  });
});
