import { describe, expect, it } from "vitest";
import { resolveGeocodingConfig, resolveMapTileConfig } from "../../src/maps/config.js";

describe("resolveMapTileConfig", () => {
  it("defaults to CARTO Voyager tiles, enabled", () => {
    const config = resolveMapTileConfig({});
    expect(config.enabled).toBe(true);
    expect(config.tileUrl).toBe(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    );
    expect(config.attribution).toContain("OpenStreetMap");
    expect(config.attribution).toContain("CARTO");
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
