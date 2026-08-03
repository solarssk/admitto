/**
 * Deployment-level config for the Location tab's map tiles and geocoding provider.
 * All values are operator-configured env vars (self-hosting deploy config), never
 * per-organization or request-supplied - same trust model as BASE_URL/DATABASE_URL.
 */

import { isLocationMapsEnabled } from "@admitto/location";

type EnvLike = Record<string, string | undefined>;

/** Default OSM raster tiles. Override with MAP_TILE_URL for CARTO / a self-hosted tile server. */
const DEFAULT_MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const DEFAULT_MAP_TILE_MAX_ZOOM = 19;

const DEFAULT_GEOCODING_PROVIDER = "nominatim";
const DEFAULT_GEOCODING_BASE_URL = "https://nominatim.openstreetmap.org";
const DEFAULT_GEOCODING_TIMEOUT_MS = 5_000;

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

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Expand Leaflet template tokens so `new URL(...)` can parse the configured tile pattern.
 * Tokens are replaced with fixed placeholders — we only care about scheme/host for CSP.
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
 * returned as "enabled" while every tile request is blocked by the browser — reject
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

/** Map tile server config for the Leaflet-based Location tab (and any future map view). */
export function resolveMapTileConfig(env: EnvLike = process.env): MapTileConfig {
  const rawUrl = env["MAP_TILE_URL"]?.trim();
  const tileUrl =
    rawUrl && isStaffSpaCompatibleTileUrl(rawUrl, env) ? rawUrl : DEFAULT_MAP_TILE_URL;
  return {
    enabled: isLocationMapsEnabled(env),
    tileUrl,
    attribution: env["MAP_TILE_ATTRIBUTION"]?.trim() || DEFAULT_MAP_TILE_ATTRIBUTION,
    maxZoom: parsePositiveInt(env["MAP_TILE_MAX_ZOOM"], DEFAULT_MAP_TILE_MAX_ZOOM),
  };
}

/** Geocoding provider config. Only "nominatim" is implemented; the env var exists so a
 * future provider can be swapped in without an app.ts wiring change. */
export function resolveGeocodingConfig(env: EnvLike = process.env): GeocodingConfig {
  return {
    provider: env["GEOCODING_PROVIDER"]?.trim() || DEFAULT_GEOCODING_PROVIDER,
    baseUrl: (env["GEOCODING_BASE_URL"]?.trim() || DEFAULT_GEOCODING_BASE_URL).replace(/\/$/, ""),
    timeoutMs: parsePositiveInt(env["GEOCODING_TIMEOUT_MS"], DEFAULT_GEOCODING_TIMEOUT_MS),
  };
}
