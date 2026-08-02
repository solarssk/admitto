import { describe, expect, it } from "vitest";
import { isLocationMapsEnabled, isMapReady } from "../src/readiness.js";

describe("isMapReady", () => {
  it("is true when both coordinates are set", () => {
    expect(isMapReady({ latitude: 50.06, longitude: 19.94 })).toBe(true);
  });

  it("is false when both coordinates are null", () => {
    expect(isMapReady({ latitude: null, longitude: null })).toBe(false);
  });

  it("is false when only latitude is set", () => {
    expect(isMapReady({ latitude: 50.06, longitude: null })).toBe(false);
  });

  it("is false when only longitude is set", () => {
    expect(isMapReady({ latitude: null, longitude: 19.94 })).toBe(false);
  });
});

describe("isLocationMapsEnabled", () => {
  it("disables only on an explicit false", () => {
    expect(isLocationMapsEnabled({ LOCATION_MAPS_ENABLED: "false" })).toBe(false);
    expect(isLocationMapsEnabled({ LOCATION_MAPS_ENABLED: "true" })).toBe(true);
    expect(isLocationMapsEnabled({ LOCATION_MAPS_ENABLED: "" })).toBe(true);
    expect(isLocationMapsEnabled({})).toBe(true);
  });
});
