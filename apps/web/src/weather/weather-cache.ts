/**
 * Redis→in-memory fail-open cache for daily forecast summaries (same shape as geocoding).
 */
import {
  InMemoryTtlStringCache,
  RedisTtlStringCache,
  type TtlStringCache,
} from "../maps/ttl-string-cache.js";
import type { DayForecast } from "./types.js";

const REDIS_KEY_PREFIX = "weather:forecast:";
const FAIL_OPEN_WARN = "Weather cache Redis unavailable; treating as cache miss";

export interface WeatherCache {
  get(key: string): Promise<DayForecast | null>;
  set(key: string, value: DayForecast, ttlMs: number): Promise<void>;
}

class WeatherCacheAdapter implements WeatherCache {
  constructor(private readonly store: TtlStringCache) {}

  async get(key: string): Promise<DayForecast | null> {
    const raw = await this.store.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as DayForecast;
    } catch {
      return null;
    }
  }

  async set(key: string, value: DayForecast, ttlMs: number): Promise<void> {
    await this.store.set(key, JSON.stringify(value), ttlMs);
  }

  /** @internal test helper */
  async disconnect(): Promise<void> {
    await this.store.disconnect?.();
  }
}

export class InMemoryWeatherCache extends WeatherCacheAdapter {
  constructor() {
    super(new InMemoryTtlStringCache());
  }
}

export class RedisWeatherCache extends WeatherCacheAdapter {
  constructor(
    url: string,
    options: { connectTimeoutMs?: number; commandTimeoutMs?: number } = {},
  ) {
    super(
      new RedisTtlStringCache(url, {
        keyPrefix: REDIS_KEY_PREFIX,
        failOpenWarn: FAIL_OPEN_WARN,
        ...options,
      }),
    );
  }
}

type EnvLike = Record<string, string | undefined>;

/** Fresh cache instance (tests / explicit inject). Prefer `getSharedWeatherCache` in request paths. */
export function createWeatherCache(env: EnvLike = process.env): WeatherCache {
  if (env["NODE_ENV"] === "test") return new InMemoryWeatherCache();
  const url = env["REDIS_URL"]?.trim();
  if (url) return new RedisWeatherCache(url);
  return new InMemoryWeatherCache();
}

/**
 * Process-wide weather cache. Request handlers must reuse this so Redis clients are not
 * opened per ticket/list call (and so the in-memory fallback actually caches across requests).
 */
let sharedWeatherCache: WeatherCache | null = null;

export function getSharedWeatherCache(env: EnvLike = process.env): WeatherCache {
  sharedWeatherCache ??= createWeatherCache(env);
  return sharedWeatherCache;
}

/** @internal */
export async function resetSharedWeatherCacheForTests(): Promise<void> {
  const previous = sharedWeatherCache as WeatherCacheAdapter | null;
  sharedWeatherCache = null;
  await previous?.disconnect();
}

/**
 * Scope forecasts by provider + Open-Meteo host so a base-URL change cannot reuse
 * another host's day row. Do not fingerprint the API key here: CodeQL treats SHA-*/MD5
 * of secrets as insufficient password hashing, and forecast payloads for a given host
 * do not depend on which organisation key fetched them.
 */
export function weatherConfigCacheScope(config: {
  provider: string;
  baseUrl: string;
}): string {
  if (config.provider === "metno") return "metno";
  const base = config.baseUrl.replace(/\/$/, "").toLowerCase();
  return `om:${base}`;
}

/** Round coords so nearby events share a cache entry (~1 km). */
export function weatherCacheKey(
  latitude: number,
  longitude: number,
  dateYmd: string,
  configScope: string,
): string {
  const lat = latitude.toFixed(2);
  const lon = longitude.toFixed(2);
  return `${lat}:${lon}:${dateYmd}:${configScope}:c`;
}
