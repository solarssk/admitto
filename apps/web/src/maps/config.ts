/**
 * Deployment-level config for the Location tab's map tiles and geocoding provider.
 * All values are operator-configured env vars (self-hosting deploy config), never
 * per-organization or request-supplied — same trust model as BASE_URL/DATABASE_URL.
 */

type EnvLike = Record<string, string | undefined>;

/** CARTO Voyager basemap (public CDN, no API key). Override with MAP_TILE_URL for OSM or a
 * self-hosted tile server. Leaflet expands `{s}` to a/b/c subdomains. */
const DEFAULT_MAP_TILE_URL =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png";
const DEFAULT_MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
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

/** Map tile server config for the Leaflet-based Location tab (and any future map view). */
export function resolveMapTileConfig(env: EnvLike = process.env): MapTileConfig {
  return {
    enabled: env["LOCATION_MAPS_ENABLED"]?.trim().toLowerCase() !== "false",
    tileUrl: env["MAP_TILE_URL"]?.trim() || DEFAULT_MAP_TILE_URL,
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
