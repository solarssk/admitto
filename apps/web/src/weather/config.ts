/**
 * Weather provider config. Organisation Settings → External services is the operator
 * source of truth (UI > built-in defaults). Env bags remain for unit tests / infra timeouts.
 */

type EnvLike = Record<string, string | undefined>;

export type WeatherProviderId = "openmeteo" | "metno";

/** Open-Meteo Forecast API horizon (days ahead, inclusive of today → day 0..15). */
export const FORECAST_HORIZON_DAYS_OPENMETEO = 16;
/** MET Norway Locationforecast 2.0 approximate horizon. */
export const FORECAST_HORIZON_DAYS_METNO = 9;

/** @deprecated Prefer forecastHorizonDays(provider). Kept as Open-Meteo default for older imports. */
export const FORECAST_HORIZON_DAYS = FORECAST_HORIZON_DAYS_OPENMETEO;

export const OPENMETEO_ATTRIBUTION_TEXT = "Weather data by Open-Meteo.com";
export const OPENMETEO_ATTRIBUTION_URL = "https://open-meteo.com/";
export const METNO_ATTRIBUTION_TEXT = "Weather data by MET Norway";
export const METNO_ATTRIBUTION_URL = "https://www.met.no/en";

/** @deprecated Use attributionForProvider("openmeteo") */
export const WEATHER_ATTRIBUTION_TEXT = OPENMETEO_ATTRIBUTION_TEXT;
/** @deprecated Use attributionForProvider("openmeteo") */
export const WEATHER_ATTRIBUTION_URL = OPENMETEO_ATTRIBUTION_URL;

export const MET_NO_FORECAST_BASE_URL =
  "https://api.met.no/weatherapi/locationforecast/2.0";

const DEFAULT_OPENMETEO_BASE_URL = "https://api.open-meteo.com";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Open-Meteo customer API host - commercial use requires an API key. */
const COMMERCIAL_OPEN_METEO_HOST = "customer-api.open-meteo.com";

export function isWeatherProviderId(value: unknown): value is WeatherProviderId {
  return value === "openmeteo" || value === "metno";
}

export function forecastHorizonDays(provider: WeatherProviderId): number {
  return provider === "metno" ? FORECAST_HORIZON_DAYS_METNO : FORECAST_HORIZON_DAYS_OPENMETEO;
}

export function attributionForProvider(provider: WeatherProviderId): {
  attribution: string;
  attributionUrl: string;
} {
  if (provider === "metno") {
    return { attribution: METNO_ATTRIBUTION_TEXT, attributionUrl: METNO_ATTRIBUTION_URL };
  }
  return { attribution: OPENMETEO_ATTRIBUTION_TEXT, attributionUrl: OPENMETEO_ATTRIBUTION_URL };
}

/**
 * True when the base URL points at Open-Meteo's commercial customer API.
 * Self-hosted hosts are not treated as commercial (API key stays optional).
 */
export function isOpenMeteoCommercialHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase();
    return host === COMMERCIAL_OPEN_METEO_HOST || host.endsWith(`.${COMMERCIAL_OPEN_METEO_HOST}`);
  } catch {
    return false;
  }
}

/** API key is required when Open-Meteo is selected, weather is on, and the host is commercial. */
export function weatherApiKeyRequired(
  provider: WeatherProviderId,
  baseUrl: string,
  enabled: boolean,
): boolean {
  return provider === "openmeteo" && enabled && isOpenMeteoCommercialHost(baseUrl);
}

export interface WeatherConfig {
  enabled: boolean;
  provider: WeatherProviderId;
  /** Open-Meteo base URL (ignored for metno runtime calls). */
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
  cacheTtlMs: number;
}

export interface WeatherConfigOverrides {
  enabled?: boolean;
  provider?: WeatherProviderId;
  baseUrl?: string | null;
  apiKey?: string | null;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
}

function parseProvider(raw: string | undefined, fallback: WeatherProviderId): WeatherProviderId {
  const v = raw?.trim().toLowerCase();
  if (v === "openmeteo" || v === "metno") return v;
  return fallback;
}

/** Built-in defaults for the operator path (no UI row yet). Default provider: MET Norway. */
export function defaultWeatherConfig(env: EnvLike = process.env): WeatherConfig {
  return {
    enabled: true,
    provider: "metno",
    baseUrl: DEFAULT_OPENMETEO_BASE_URL,
    apiKey: null,
    timeoutMs: parsePositiveInt(env["OPEN_METEO_TIMEOUT_MS"], DEFAULT_TIMEOUT_MS),
    cacheTtlMs: parsePositiveInt(env["WEATHER_CACHE_TTL_MS"], DEFAULT_CACHE_TTL_MS),
  };
}

/**
 * Env-bag config for unit tests and health probes that pass an explicit object.
 * Live process resolution uses SystemSettings via weather-org-settings.
 *
 * When OPEN_METEO_BASE_URL / OPEN_METEO_API_KEY is set without WEATHER_PROVIDER,
 * treat as openmeteo (legacy test / infra bags).
 */
export function resolveWeatherEnvConfig(env: EnvLike = process.env): WeatherConfig {
  if (env === process.env) return defaultWeatherConfig(env);
  const hasOpenMeteoHints = Boolean(
    env["OPEN_METEO_BASE_URL"]?.trim() || env["OPEN_METEO_API_KEY"]?.trim(),
  );
  const provider = parseProvider(
    env["WEATHER_PROVIDER"],
    hasOpenMeteoHints ? "openmeteo" : "metno",
  );
  const baseUrl = (env["OPEN_METEO_BASE_URL"]?.trim() || DEFAULT_OPENMETEO_BASE_URL).replace(
    /\/$/,
    "",
  );
  const apiKey = env["OPEN_METEO_API_KEY"]?.trim() || null;
  return {
    enabled: parseBool(env["WEATHER_ENABLED"], true),
    provider,
    baseUrl,
    apiKey,
    timeoutMs: parsePositiveInt(env["OPEN_METEO_TIMEOUT_MS"], DEFAULT_TIMEOUT_MS),
    cacheTtlMs: parsePositiveInt(env["WEATHER_CACHE_TTL_MS"], DEFAULT_CACHE_TTL_MS),
  };
}

/**
 * Merge org UI overrides over a base config. Explicit `enabled: false` disables;
 * empty override fields fall through to the base.
 */
export function mergeWeatherConfig(
  base: WeatherConfig,
  overrides: WeatherConfigOverrides | null | undefined,
): WeatherConfig {
  if (!overrides) return base;
  const baseUrl =
    overrides.baseUrl != null && overrides.baseUrl.trim() !== ""
      ? overrides.baseUrl.trim().replace(/\/$/, "")
      : base.baseUrl;
  const apiKey =
    overrides.apiKey !== undefined
      ? overrides.apiKey?.trim() || null
      : base.apiKey;
  return {
    ...base,
    enabled: overrides.enabled ?? base.enabled,
    provider: overrides.provider ?? base.provider,
    baseUrl,
    apiKey,
  };
}
