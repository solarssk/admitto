import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isMapsConfigCacheStale,
  mapsConfigCacheTtlMs,
  markMapsConfigCacheStale,
  resolveGeocodingConfig,
  resolveMapTileConfig,
  setMapsConfigCache,
  getMapsConfigCache,
  defaultGeocodingConfig,
  defaultMapTileConfig,
} from "../../src/maps/config.js";

const OSM_DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

afterEach(() => {
  setMapsConfigCache(null);
});

describe("resolveMapTileConfig", () => {
  it("defaults to OpenStreetMap tiles, enabled", () => {
    const config = resolveMapTileConfig({});
    expect(config.enabled).toBe(true);
    expect(config.tileUrl).toBe(OSM_DEFAULT_TILE_URL);
    expect(config.attribution).toContain("OpenStreetMap");
    expect(config.attribution).not.toContain("CARTO");
    expect(config.maxZoom).toBe(19);
  });

  it("disables maps only on an explicit LOCATION_MAPS_ENABLED=false", () => {
    expect(resolveMapTileConfig({ LOCATION_MAPS_ENABLED: "false" }).enabled).toBe(false);
    expect(resolveMapTileConfig({ LOCATION_MAPS_ENABLED: "true" }).enabled).toBe(true);
    expect(resolveMapTileConfig({ LOCATION_MAPS_ENABLED: "" }).enabled).toBe(true);
  });

  it("honors overrides for tile URL, attribution, and max zoom", () => {
    const config = resolveMapTileConfig({
      MAP_TILE_URL: "https://tiles.example.com/{z}/{x}/{y}.png",
      MAP_TILE_ATTRIBUTION: "Custom attribution",
      MAP_TILE_MAX_ZOOM: "12",
    });
    expect(config.tileUrl).toBe("https://tiles.example.com/{z}/{x}/{y}.png");
    expect(config.attribution).toBe("Custom attribution");
    expect(config.maxZoom).toBe(12);
  });

  it("ignores plain-HTTP remote tile URLs that the staff SPA CSP would block", () => {
    const config = resolveMapTileConfig({
      MAP_TILE_URL: "http://tiles.internal.example/{z}/{x}/{y}.png",
    });
    expect(config.tileUrl).toBe(OSM_DEFAULT_TILE_URL);
  });

  it("falls back when the tile URL is not parseable", () => {
    expect(resolveMapTileConfig({ MAP_TILE_URL: "not a URL" }).tileUrl).toBe(OSM_DEFAULT_TILE_URL);
  });

  it("allows http://localhost tile URLs only in development", () => {
    expect(
      resolveMapTileConfig({
        NODE_ENV: "development",
        MAP_TILE_URL: "http://localhost:8080/{z}/{x}/{y}.png",
      }).tileUrl,
    ).toBe("http://localhost:8080/{z}/{x}/{y}.png");

    expect(
      resolveMapTileConfig({
        NODE_ENV: "development",
        MAP_TILE_URL: "http://127.0.0.1:8080/{z}/{x}/{y}.png",
      }).tileUrl,
    ).toBe("http://127.0.0.1:8080/{z}/{x}/{y}.png");

    expect(
      resolveMapTileConfig({
        NODE_ENV: "production",
        MAP_TILE_URL: "http://localhost:8080/{z}/{x}/{y}.png",
      }).tileUrl,
    ).toBe(OSM_DEFAULT_TILE_URL);
  });

  it("rejects an unparseable MAP_TILE_URL and keeps the HTTPS default", () => {
    expect(
      resolveMapTileConfig({
        MAP_TILE_URL: "not a url at all {{{",
      }).tileUrl,
    ).toBe(OSM_DEFAULT_TILE_URL);
  });

  it("falls back to the default max zoom on a non-numeric override", () => {
    expect(resolveMapTileConfig({ MAP_TILE_MAX_ZOOM: "not-a-number" }).maxZoom).toBe(19);
    expect(resolveMapTileConfig({ MAP_TILE_MAX_ZOOM: "-5" }).maxZoom).toBe(19);
  });
});

describe("resolveGeocodingConfig", () => {
  it("defaults to Nominatim's public server", () => {
    const config = resolveGeocodingConfig({});
    expect(config.provider).toBe("nominatim");
    expect(config.baseUrl).toBe("https://nominatim.openstreetmap.org");
    expect(config.timeoutMs).toBe(5_000);
  });

  it("honors overrides and strips a trailing slash from the base URL", () => {
    const config = resolveGeocodingConfig({
      GEOCODING_PROVIDER: "custom",
      GEOCODING_BASE_URL: "https://geocode.example.com/",
      GEOCODING_TIMEOUT_MS: "8000",
    });
    expect(config.provider).toBe("custom");
    expect(config.baseUrl).toBe("https://geocode.example.com");
    expect(config.timeoutMs).toBe(8_000);
  });

  it("falls back to the default timeout on a non-numeric override", () => {
    expect(resolveGeocodingConfig({ GEOCODING_TIMEOUT_MS: "abc" }).timeoutMs).toBe(5_000);
  });
});

describe("maps config cache TTL", () => {
  it("defaults TTL to 30s and rejects non-positive overrides", () => {
    expect(mapsConfigCacheTtlMs({})).toBe(30_000);
    expect(mapsConfigCacheTtlMs({ MAPS_CONFIG_CACHE_TTL_MS: "15000" })).toBe(15_000);
    expect(mapsConfigCacheTtlMs({ MAPS_CONFIG_CACHE_TTL_MS: "0" })).toBe(30_000);
    expect(mapsConfigCacheTtlMs({ MAPS_CONFIG_CACHE_TTL_MS: "nope" })).toBe(30_000);
  });

  it("treats a missing cache as stale and a fresh load as not stale", () => {
    expect(isMapsConfigCacheStale({})).toBe(true);
    setMapsConfigCache({
      tiles: defaultMapTileConfig(),
      geocoding: defaultGeocodingConfig(),
    });
    expect(isMapsConfigCacheStale({ MAPS_CONFIG_CACHE_TTL_MS: "60000" }, Date.now())).toBe(false);
  });

  it("marks the cache stale without clearing last-known config", () => {
    setMapsConfigCache({
      tiles: { ...defaultMapTileConfig(), enabled: false },
      geocoding: defaultGeocodingConfig(),
    });
    markMapsConfigCacheStale();
    expect(getMapsConfigCache()?.tiles.enabled).toBe(false);
    expect(isMapsConfigCacheStale({ MAPS_CONFIG_CACHE_TTL_MS: "60000" })).toBe(true);
  });

  it("expires after the configured TTL", () => {
    const loadedAt = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(loadedAt);
    setMapsConfigCache({
      tiles: defaultMapTileConfig(),
      geocoding: defaultGeocodingConfig(),
    });
    expect(isMapsConfigCacheStale({ MAPS_CONFIG_CACHE_TTL_MS: "1000" }, loadedAt + 999)).toBe(
      false,
    );
    expect(isMapsConfigCacheStale({ MAPS_CONFIG_CACHE_TTL_MS: "1000" }, loadedAt + 1000)).toBe(
      true,
    );
    vi.restoreAllMocks();
  });
});
