/**
 * MET Norway Locationforecast 2.0 compact client.
 * Requires an identifiable User-Agent (reuse Support contact via buildGeocodingUserAgent).
 * https://api.met.no/weatherapi/locationforecast/2.0/documentation
 */

import { MET_NO_FORECAST_BASE_URL } from "./config.js";
import { WeatherProviderError } from "./open-meteo-client.js";
import type { DayForecast } from "./types.js";

export interface MetNoClientOptions {
  timeoutMs: number;
  userAgent: string;
  fetchFn?: typeof fetch;
}

/** Calendar YYYY-MM-DD in `timezone` (falls back to UTC). Local copy avoids a cycle with WeatherService. */
function ymdInTimezone(date: Date | string, timezone: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

interface MetNoTimeseriesPoint {
  time?: unknown;
  data?: {
    instant?: { details?: { air_temperature?: unknown } };
    next_1_hours?: { summary?: { symbol_code?: unknown } };
    next_6_hours?: { summary?: { symbol_code?: unknown } };
    next_12_hours?: { summary?: { symbol_code?: unknown } };
  };
}

interface MetNoCompactJson {
  properties?: { timeseries?: unknown };
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

function roundCoord(n: number): string {
  return n.toFixed(4);
}

/**
 * Map MET Norway symbol_code (optionally with _day/_night/_polartwilight) to a
 * WMO-ish code understood by weatherCodeInfo.
 */
export function metNoSymbolToWeatherCode(symbol: string): number {
  const base = symbol.replace(/_(day|night|polartwilight)$/i, "").toLowerCase();
  if (base === "clearsky") return 0;
  if (base === "fair") return 1;
  if (base === "partlycloudy") return 2;
  if (base === "cloudy") return 3;
  if (base === "fog") return 45;
  if (base.includes("drizzle")) return 51;
  if (base.includes("thunder")) return 95;
  if (base.includes("sleet")) return 66;
  if (base.includes("snow")) return 71;
  if (base.includes("rainshower")) return 80;
  if (base.includes("rain")) return 61;
  return 3;
}

function asTimeseries(raw: unknown): MetNoTimeseriesPoint[] | null {
  if (!Array.isArray(raw)) return null;
  return raw as MetNoTimeseriesPoint[];
}

function readTemp(point: MetNoTimeseriesPoint): number | null {
  const t = point.data?.instant?.details?.air_temperature;
  return typeof t === "number" && Number.isFinite(t) ? t : null;
}

function readSymbol(point: MetNoTimeseriesPoint): string | null {
  for (const key of ["next_1_hours", "next_6_hours", "next_12_hours"] as const) {
    const code = point.data?.[key]?.summary?.symbol_code;
    if (typeof code === "string" && code.trim() !== "") return code.trim();
  }
  return null;
}

function localHour(isoTime: string, timezone: string): number | null {
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone || "UTC",
        hour: "numeric",
        hour12: false,
      }).format(new Date(isoTime)),
    );
  } catch {
    return null;
  }
}

type DailyAccum = {
  tempMin: number;
  tempMax: number;
  symbols: string[];
  middaySymbol: string | null;
};

function accumulateMetNoPoint(
  point: MetNoTimeseriesPoint,
  dateYmd: string,
  timezone: string,
  acc: DailyAccum,
): void {
  if (typeof point.time !== "string") return;
  if (ymdInTimezone(point.time, timezone) !== dateYmd) return;

  const temp = readTemp(point);
  if (temp != null) {
    acc.tempMin = Math.min(acc.tempMin, temp);
    acc.tempMax = Math.max(acc.tempMax, temp);
  }

  const symbol = readSymbol(point);
  if (!symbol) return;
  acc.symbols.push(symbol);
  // Prefer a midday-ish sample (11:00-14:00 local) for the icon.
  const hour = localHour(point.time, timezone);
  if (hour != null && hour >= 11 && hour <= 14) acc.middaySymbol = symbol;
}

/** Aggregate hourly compact points into a daily min/max + representative symbol. */
export function pickMetNoDailyForecast(
  body: MetNoCompactJson,
  dateYmd: string,
  timezone: string,
): DayForecast | null {
  const series = asTimeseries(body.properties?.timeseries);
  if (!series || series.length === 0) return null;

  const acc: DailyAccum = {
    tempMin: Number.POSITIVE_INFINITY,
    tempMax: Number.NEGATIVE_INFINITY,
    symbols: [],
    middaySymbol: null,
  };
  for (const point of series) {
    accumulateMetNoPoint(point, dateYmd, timezone, acc);
  }

  if (!Number.isFinite(acc.tempMin) || !Number.isFinite(acc.tempMax)) return null;
  const symbol = acc.middaySymbol ?? acc.symbols[Math.floor(acc.symbols.length / 2)] ?? "cloudy";
  return {
    date: dateYmd,
    weather_code: metNoSymbolToWeatherCode(symbol),
    temp_max_c: acc.tempMax,
    temp_min_c: acc.tempMin,
  };
}

export class MetNoClient {
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: MetNoClientOptions) {
    this.timeoutMs = options.timeoutMs;
    this.userAgent = options.userAgent;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async fetchDayForecast(
    latitude: number,
    longitude: number,
    dateYmd: string,
    timezone: string,
  ): Promise<DayForecast> {
    const url = new URL(`${MET_NO_FORECAST_BASE_URL}/compact`);
    url.searchParams.set("lat", roundCoord(latitude));
    url.searchParams.set("lon", roundCoord(longitude));

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": this.userAgent,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (isTimeoutError(err)) throw new WeatherProviderError("timeout", { cause: err });
      throw new WeatherProviderError("unavailable", { cause: err });
    }

    if (!response.ok) {
      throw new WeatherProviderError("unavailable");
    }

    let body: MetNoCompactJson;
    try {
      body = (await response.json()) as MetNoCompactJson;
    } catch (err) {
      throw new WeatherProviderError("unavailable", { cause: err });
    }

    const day = pickMetNoDailyForecast(body, dateYmd, timezone);
    if (!day) throw new WeatherProviderError("unavailable");
    return day;
  }

  /** Lightweight health probe (today at a fixed pin). */
  async probe(timezone = "UTC"): Promise<void> {
    const today = ymdInTimezone(new Date(), timezone);
    await this.fetchDayForecast(59.91, 10.75, today, timezone);
  }
}
