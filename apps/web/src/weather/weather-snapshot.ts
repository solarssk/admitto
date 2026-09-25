/**
 * The last forecast Admitto saw for an event day, kept on the event (`Event.weather_snapshot`).
 * Weather providers cannot look back once that day is over (MET Norway serves forecasts only,
 * Open-Meteo's forecast window starts today), so this is what an ended event's card shows.
 */

import { isWeatherProviderId, type WeatherProviderId } from "./config.js";
import type { WeatherSummaryDto } from "./types.js";

// A type alias, not an interface: Prisma only accepts an alias as a JSON value.
export type WeatherSnapshot = {
  v: 1;
  /** Event calendar day (YYYY-MM-DD in the event timezone) the forecast is for. */
  date: string;
  /** Event pin, rounded like the forecast cache key, so a moved event never shows a stale one. */
  lat: number;
  lon: number;
  /** Provider that gave it: the card credits this one, even after the setting changed. */
  provider: WeatherProviderId;
  temp_c: number;
  temp_min_c: number;
  weather_code: number;
  /** When it was saved (ISO). Informational only. */
  captured_at: string;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** A coordinate the way the forecast cache key rounds it: 2 decimals, about a kilometre. */
function roundPin(n: number): number {
  return Number(n.toFixed(2));
}

/** A stored JSON value as a snapshot, or null when it is missing or not one this code wrote. */
export function parseWeatherSnapshot(raw: unknown): WeatherSnapshot | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const { date, lat, lon, provider, temp_c, temp_min_c, weather_code, captured_at } = o;
  if (o["v"] !== 1 || typeof date !== "string" || !YMD.test(date)) return null;
  if (!isWeatherProviderId(provider) || typeof captured_at !== "string") return null;
  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    typeof temp_c !== "number" ||
    typeof temp_min_c !== "number" ||
    typeof weather_code !== "number" ||
    ![lat, lon, temp_c, temp_min_c, weather_code].every(Number.isFinite)
  ) {
    return null;
  }
  return { v: 1, date, lat, lon, provider, temp_c, temp_min_c, weather_code, captured_at };
}

/** The stored snapshot, if it still belongs to this event's day and pin; otherwise null. */
export function snapshotForEvent(
  raw: unknown,
  at: { latitude: number; longitude: number; eventYmd: string },
): WeatherSnapshot | null {
  const snapshot = parseWeatherSnapshot(raw);
  if (snapshot?.date !== at.eventYmd) return null;
  if (snapshot.lat !== roundPin(at.latitude) || snapshot.lon !== roundPin(at.longitude)) return null;
  return snapshot;
}

export interface SnapshotDecisionInput {
  /** The stored snapshot that still fits this event (see {@link snapshotForEvent}), or null. */
  current: WeatherSnapshot | null;
  /** What the provider or cache just returned for the event (nothing at all is fine too). */
  summary: WeatherSummaryDto | null | undefined;
  provider: WeatherProviderId;
  latitude: number;
  longitude: number;
  eventYmd: string;
  /** Whole days from today to the event day, both in the event timezone (negative once over). */
  offsetDays: number;
  now: Date;
}

/**
 * The snapshot to save after a forecast was seen, or null when nothing should be written.
 * A forecast for a day that is still ahead always replaces the stored one: it is the newest look
 * at the whole day. On the day itself MET Norway only returns the hours that are left, so that
 * reading may only fill an empty snapshot and must never overwrite a full-day one. Unchanged
 * values are not rewritten.
 */
export function nextWeatherSnapshot(input: SnapshotDecisionInput): WeatherSnapshot | null {
  const { current, summary, offsetDays } = input;
  if (summary?.status !== "ok") return null;
  const { temp_c, temp_min_c, weather_code } = summary;
  if (temp_c == null || temp_min_c == null || weather_code == null) return null;
  if (offsetDays < 0 || (offsetDays === 0 && current)) return null;
  if (
    current?.provider === input.provider &&
    current.temp_c === temp_c &&
    current.temp_min_c === temp_min_c &&
    current.weather_code === weather_code
  ) {
    return null;
  }
  return {
    v: 1,
    date: input.eventYmd,
    lat: roundPin(input.latitude),
    lon: roundPin(input.longitude),
    provider: input.provider,
    temp_c,
    temp_min_c,
    weather_code,
    captured_at: input.now.toISOString(),
  };
}
