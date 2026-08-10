/**
 * Open-Meteo Forecast API client (daily variables for a single calendar day).
 * Base URL is validated at save/probe (`assertEditableServiceUrl`), but that check is
 * save-time only (TOCTOU) — production requests re-resolve the host and pin the connection
 * to the validated address via `withPinnedFetch`, closing the DNS-rebinding gap. `fetchFn`
 * (test-only DI) bypasses pinning, same convention as `PowerAutomateAdapter`.
 */

import { resolveSafeHostname, unbracketHostname } from "@admitto/shared/ssrf-guard";
import { withPinnedFetch } from "../net/pinned-fetch.js";
import { FORECAST_HORIZON_DAYS_OPENMETEO, type WeatherConfig } from "./config.js";
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

function asNullableNumberArray(value: unknown): Array<number | null> | null {
  if (!Array.isArray(value)) return null;
  const out: Array<number | null> = [];
  for (const item of value) {
    if (item == null) {
      out.push(null);
      continue;
    }
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
  const codes = asNullableNumberArray(body.daily?.weather_code);
  const maxes = asNullableNumberArray(body.daily?.temperature_2m_max);
  const mins = asNullableNumberArray(body.daily?.temperature_2m_min);
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
  private readonly fetchOverride?: typeof fetch;

  constructor(options: OpenMeteoClientOptions) {
    this.config = options.config;
    this.fetchOverride = options.fetchFn;
  }

  /**
   * Fetch daily forecast covering `dateYmd`. Caller must ensure the date is within
   * the provider horizon (or accept a null miss).
   */
  async fetchDayForecast(
    latitude: number,
    longitude: number,
    dateYmd: string,
    timezone = "UTC",
  ): Promise<DayForecast> {
    const url = new URL(`${this.config.baseUrl}/v1/forecast`);
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min",
    );
    // Match WeatherService.eventDateYmd: daily buckets in the event IANA zone, not geo-auto.
    url.searchParams.set("timezone", timezone.trim() || "UTC");
    url.searchParams.set("forecast_days", String(FORECAST_HORIZON_DAYS_OPENMETEO));
    url.searchParams.set("temperature_unit", "celsius");
    if (this.config.apiKey) {
      // Never attach apikey on cleartext HTTP (CWE-319); keyless http: remains allowed for lab proxies.
      if (url.protocol !== "https:") {
        throw new WeatherProviderError("unavailable");
      }
      url.searchParams.set("apikey", this.config.apiKey);
    }

    const handleResponse = async (response: Response): Promise<DayForecast> => {
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
    };

    try {
      // Do not follow redirects: host was checked at config time; a 30x to
      // loopback/private/metadata would bypass that check (same as Power Automate).
      if (this.fetchOverride) {
        const response = await this.fetchOverride(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        return await handleResponse(response);
      }
      // No test override: pin the connection to a freshly re-resolved, SSRF-validated
      // address (see net/pinned-fetch.ts) so a DNS-rebound host can't be reached at connect
      // time even though it passed the save-time check.
      const hostname = unbracketHostname(url.hostname);
      const records = await resolveSafeHostname(hostname);
      return await withPinnedFetch(
        url,
        hostname,
        records[0]!,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
        handleResponse,
      );
    } catch (err) {
      if (err instanceof WeatherProviderError) throw err;
      if (isTimeoutError(err)) throw new WeatherProviderError("timeout", { cause: err });
      throw new WeatherProviderError("unavailable", { cause: err });
    }
  }

  /** Lightweight health probe (today's forecast for a fixed pin). */
  async probe(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    await this.fetchDayForecast(52.52, 13.41, today, "UTC");
  }
}
