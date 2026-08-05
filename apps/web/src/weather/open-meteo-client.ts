/**
 * Open-Meteo Forecast API client (daily variables for a single calendar day).
 * Trusted deploy/org base URL — same trust model as GEOCODING_BASE_URL (no SSRF pin).
 */

import type { WeatherConfig } from "./config.js";
import type { DayForecast } from "./types.js";

export class WeatherProviderError extends Error {
  readonly kind: "timeout" | "unavailable";

  constructor(kind: "timeout" | "unavailable", options?: ErrorOptions) {
    super(`weather provider error: ${kind}`, options);
    this.name = "WeatherProviderError";
    this.kind = kind;
  }
}

export interface OpenMeteoClientOptions {
  config: WeatherConfig;
  fetchFn?: typeof fetch;
}

interface ForecastDailyJson {
  daily?: {
    time?: unknown;
    weather_code?: unknown;
    temperature_2m_max?: unknown;
    temperature_2m_min?: unknown;
  };
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

function asNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) return null;
    out.push(item);
  }
  return out;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

/** Parse daily arrays and pick the row matching `dateYmd` (YYYY-MM-DD). */
export function pickDailyForecast(body: ForecastDailyJson, dateYmd: string): DayForecast | null {
  const times = asStringArray(body.daily?.time);
  const codes = asNumberArray(body.daily?.weather_code);
  const maxes = asNumberArray(body.daily?.temperature_2m_max);
  const mins = asNumberArray(body.daily?.temperature_2m_min);
  if (!times || !codes || !maxes || !mins) return null;
  const idx = times.indexOf(dateYmd);
  if (idx < 0) return null;
  const weather_code = codes[idx];
  const temp_max_c = maxes[idx];
  const temp_min_c = mins[idx];
  if (weather_code == null || temp_max_c == null || temp_min_c == null) return null;
  return { date: dateYmd, weather_code, temp_max_c, temp_min_c };
}

export class OpenMeteoClient {
  private readonly config: WeatherConfig;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenMeteoClientOptions) {
    this.config = options.config;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  /**
   * Fetch daily forecast covering `dateYmd`. Caller must ensure the date is within
   * the provider horizon (or accept a null miss).
   */
  async fetchDayForecast(
    latitude: number,
    longitude: number,
    dateYmd: string,
  ): Promise<DayForecast> {
    const url = new URL(`${this.config.baseUrl}/v1/forecast`);
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min",
    );
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", "16");
    url.searchParams.set("temperature_unit", "celsius");
    if (this.config.apiKey) {
      url.searchParams.set("apikey", this.config.apiKey);
    }

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      if (isTimeoutError(err)) throw new WeatherProviderError("timeout", { cause: err });
      throw new WeatherProviderError("unavailable", { cause: err });
    }

    if (!response.ok) {
      throw new WeatherProviderError("unavailable");
    }

    let body: ForecastDailyJson;
    try {
      body = (await response.json()) as ForecastDailyJson;
    } catch (err) {
      throw new WeatherProviderError("unavailable", { cause: err });
    }

    const day = pickDailyForecast(body, dateYmd);
    if (!day) throw new WeatherProviderError("unavailable");
    return day;
  }

  /** Lightweight health probe (today's forecast for a fixed pin). */
  async probe(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    await this.fetchDayForecast(52.52, 13.41, today);
  }
}
