/**
 * Map tile and geocoding config. Organisation Settings → External services (UI) is the
 * operator source of truth via the process cache refreshed from SystemSettings. Built-in
 * defaults apply when no UI row exists. Env-like bags remain for unit tests.
 */

import { isLocationMapsEnabled } from "@admitto/location";

type EnvLike = Record<string, string | undefined>;

/** Default OSM raster tiles. */
const DEFAULT_MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const DEFAULT_MAP_TILE_MAX_ZOOM = 19;

const DEFAULT_GEOCODING_PROVIDER = "nominatim";
const DEFAULT_GEOCODING_BASE_URL = "https://nominatim.openstreetmap.org";
const DEFAULT_GEOCODING_TIMEOUT_MS = 5_000;

/** How long a process may keep maps settings before re-reading SystemSettings (multi-instance). */
const DEFAULT_MAPS_CONFIG_CACHE_TTL_MS = 30_000;

export interface MapTileConfig {
  enabled: boolean;
  tileUrl: string;
  attribution: string;
  maxZoom: number;
}

export interface GeocodingConfig {
  provider: string;
  baseUrl: string;
  timeoutMs: number;
}

export interface MapsRuntimeConfig {
  tiles: MapTileConfig;
  geocoding: GeocodingConfig;
}

type MapsCacheEntry = {
  config: MapsRuntimeConfig;
  loadedAtMs: number;
};

/** Live process cache (UI / SystemSettings). Null until boot refresh or first save. */
let mapsRuntimeCache: MapsCacheEntry | null = null;

export function mapsConfigCacheTtlMs(env: EnvLike = process.env): number {
  const raw = env["MAPS_CONFIG_CACHE_TTL_MS"]?.trim();
  if (!raw) return DEFAULT_MAPS_CONFIG_CACHE_TTL_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAPS_CONFIG_CACHE_TTL_MS;
}

export function getMapsConfigCache(): MapsRuntimeConfig | null {
  return mapsRuntimeCache?.config ?? null;
}

export function setMapsConfigCache(config: MapsRuntimeConfig | null): void {
  mapsRuntimeCache = config ? { config, loadedAtMs: Date.now() } : null;
}

/** Keep last-known config but force the next ensure/refresh path to re-read SystemSettings. */
export function markMapsConfigCacheStale(): void {
  if (mapsRuntimeCache) {
    mapsRuntimeCache = { ...mapsRuntimeCache, loadedAtMs: 0 };
  }
}

export function isMapsConfigCacheStale(
  env: EnvLike = process.env,
  nowMs: number = Date.now(),
): boolean {
  if (!mapsRuntimeCache) return true;
  return nowMs - mapsRuntimeCache.loadedAtMs >= mapsConfigCacheTtlMs(env);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Expand Leaflet template tokens so `new URL(...)` can parse the configured tile pattern.
 * Tokens are replaced with fixed placeholders - we only care about scheme/host for CSP.
 */
function expandTileUrlForParse(raw: string): string {
  return raw
    .replaceAll("{s}", "a")
    .replaceAll("{z}", "0")
    .replaceAll("{x}", "0")
    .replaceAll("{y}", "0")
    .replaceAll("{r}", "");
}

/**
 * Staff SPA CSP (`staff-spa.ts`) allows `img-src 'self' data: https:` in production
 * (plus `http://localhost:*` in development). A plain-HTTP custom tile server would be
 * returned as "enabled" while every tile request is blocked by the browser - reject
 * those URLs so we never advertise a map that cannot load.
 */
export function isStaffSpaCompatibleTileUrl(raw: string, env: EnvLike = process.env): boolean {
  let url: URL;
  try {
    url = new URL(expandTileUrlForParse(raw));
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  if (
    env["NODE_ENV"] === "development" &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  ) {
    return true;
  }
  return false;
}

/** Built-in OSM defaults (operator path when no UI row; ignores LOCATION_MAPS_*). */
export function defaultMapTileConfig(_env: EnvLike = process.env): MapTileConfig {
  return {
    enabled: true,
    tileUrl: DEFAULT_MAP_TILE_URL,
    attribution: DEFAULT_MAP_TILE_ATTRIBUTION,
    maxZoom: DEFAULT_MAP_TILE_MAX_ZOOM,
  };
}

/** Built-in Nominatim defaults. Timeout may still follow env for infra tuning. */
export function defaultGeocodingConfig(env: EnvLike = process.env): GeocodingConfig {
  return {
    provider: DEFAULT_GEOCODING_PROVIDER,
    baseUrl: DEFAULT_GEOCODING_BASE_URL,
    timeoutMs: parsePositiveInt(env["GEOCODING_TIMEOUT_MS"], DEFAULT_GEOCODING_TIMEOUT_MS),
  };
}

/**
 * Resolve map tiles for the live process: UI cache when loaded, otherwise env-like bag
 * (tests) or built-in defaults.
 */
export function resolveMapTileConfig(env: EnvLike = process.env): MapTileConfig {
  if (mapsRuntimeCache && env === process.env) return mapsRuntimeCache.config.tiles;
  // Live process without cache yet: built-in defaults (UI loads at boot). Env bags are
  // only for unit tests that pass an explicit object.
  if (env === process.env) return defaultMapTileConfig(env);

  const rawUrl = env["MAP_TILE_URL"]?.trim();
  const tileUrl =
    rawUrl && isStaffSpaCompatibleTileUrl(rawUrl, env) ? rawUrl : DEFAULT_MAP_TILE_URL;
  const hasMapsEnv =
    env["LOCATION_MAPS_ENABLED"] != null ||
    env["MAP_TILE_URL"] != null ||
    env["MAP_TILE_ATTRIBUTION"] != null ||
    env["MAP_TILE_MAX_ZOOM"] != null;

  if (!hasMapsEnv) {
    return defaultMapTileConfig(env);
  }

  return {
    enabled: isLocationMapsEnabled(env),
    tileUrl,
    attribution: env["MAP_TILE_ATTRIBUTION"]?.trim() || DEFAULT_MAP_TILE_ATTRIBUTION,
    maxZoom: parsePositiveInt(env["MAP_TILE_MAX_ZOOM"], DEFAULT_MAP_TILE_MAX_ZOOM),
  };
}

/** Geocoding config: UI cache when loaded, else env-like / defaults. */
export function resolveGeocodingConfig(env: EnvLike = process.env): GeocodingConfig {
  if (mapsRuntimeCache && env === process.env) return mapsRuntimeCache.config.geocoding;
  if (env === process.env) return defaultGeocodingConfig(env);

  const hasGeoEnv =
    env["GEOCODING_PROVIDER"] != null ||
    env["GEOCODING_BASE_URL"] != null ||
    env["GEOCODING_TIMEOUT_MS"] != null;

  if (!hasGeoEnv) {
    return defaultGeocodingConfig(env);
  }

  return {
    provider: env["GEOCODING_PROVIDER"]?.trim() || DEFAULT_GEOCODING_PROVIDER,
    baseUrl: (env["GEOCODING_BASE_URL"]?.trim() || DEFAULT_GEOCODING_BASE_URL).replace(/\/$/, ""),
    timeoutMs: parsePositiveInt(env["GEOCODING_TIMEOUT_MS"], DEFAULT_GEOCODING_TIMEOUT_MS),
  };
}
