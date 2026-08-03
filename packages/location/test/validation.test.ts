import { describe, expect, it } from "vitest";
import {
  LOCATION_LIMITS,
  LocationValidationError,
  normalizeEventLocationInput,
  assertCoordinatePairing,
} from "../src/validation.js";

describe("normalizeEventLocationInput", () => {
  it("omits keys that were not provided", () => {
    expect(normalizeEventLocationInput({})).toEqual({});
  });

  it("trims text fields and passes through valid values", () => {
    const result = normalizeEventLocationInput({
      venue_name: "  ICE Kraków Congress Centre  ",
      formatted_address: "  ICE Kraków, ul. Marii Konopnickiej 17  ",
      directions_text: "  Enter via gate B  ",
      accessibility_text: "  Step-free access  ",
    });
    expect(result).toEqual({
      venue_name: "ICE Kraków Congress Centre",
      formatted_address: "ICE Kraków, ul. Marii Konopnickiej 17",
      directions_text: "Enter via gate B",
      accessibility_text: "Step-free access",
    });
  });

  it("normalizes empty/whitespace-only text to null (clears the field)", () => {
    const result = normalizeEventLocationInput({
      venue_name: "   ",
      formatted_address: "   ",
      directions_text: "",
    });
    expect(result.venue_name).toBeNull();
    expect(result.formatted_address).toBeNull();
    expect(result.directions_text).toBeNull();
  });

  it("passes explicit null through as null for text fields", () => {
    const result = normalizeEventLocationInput({ formatted_address: null });
    expect(result.formatted_address).toBeNull();
  });

  it.each([
    ["venue_name", LOCATION_LIMITS.VENUE_NAME_MAX_LENGTH],
    ["formatted_address", LOCATION_LIMITS.ADDRESS_MAX_LENGTH],
    ["directions_text", LOCATION_LIMITS.TEXT_MAX_LENGTH],
    ["accessibility_text", LOCATION_LIMITS.TEXT_MAX_LENGTH],
  ])("rejects %s longer than its max length", (field, maxLength) => {
    const tooLong = "a".repeat(maxLength + 1);
    expect(() => normalizeEventLocationInput({ [field]: tooLong })).toThrow(LocationValidationError);
  });

  it.each([
    ["venue_name", "a".repeat(LOCATION_LIMITS.VENUE_NAME_MAX_LENGTH)],
    ["formatted_address", "a".repeat(LOCATION_LIMITS.ADDRESS_MAX_LENGTH)],
    ["directions_text", "a".repeat(LOCATION_LIMITS.TEXT_MAX_LENGTH)],
  ])("accepts %s exactly at its max length", (field, value) => {
    expect(() => normalizeEventLocationInput({ [field]: value })).not.toThrow();
  });

  it("accepts valid coordinates at the boundary", () => {
    const result = normalizeEventLocationInput({ latitude: -90, longitude: 180 });
    expect(result).toEqual({ latitude: -90, longitude: 180 });
  });

  it.each([
    ["latitude", 90.0001],
    ["latitude", -90.0001],
    ["longitude", 180.0001],
    ["longitude", -180.0001],
  ])("rejects out-of-range %s = %d", (field, value) => {
    expect(() => normalizeEventLocationInput({ [field]: value })).toThrow(LocationValidationError);
  });

  it("rejects non-finite coordinates", () => {
    expect(() => normalizeEventLocationInput({ latitude: Number.NaN })).toThrow(LocationValidationError);
    expect(() => normalizeEventLocationInput({ longitude: Number.POSITIVE_INFINITY })).toThrow(
      LocationValidationError,
    );
  });

  it("passes explicit null through for coordinates", () => {
    const result = normalizeEventLocationInput({ latitude: null, longitude: null });
    expect(result).toEqual({ latitude: null, longitude: null });
  });

  it.each([1, 15, 19])("accepts map_zoom = %d", (zoom) => {
    expect(normalizeEventLocationInput({ map_zoom: zoom })).toEqual({ map_zoom: zoom });
  });

  it.each([0, 20, 1.5])("rejects invalid map_zoom = %d", (zoom) => {
    expect(() => normalizeEventLocationInput({ map_zoom: zoom })).toThrow(LocationValidationError);
  });

  it("resets map_zoom to the default when explicitly null", () => {
    expect(normalizeEventLocationInput({ map_zoom: null })).toEqual({
      map_zoom: LOCATION_LIMITS.DEFAULT_ZOOM,
    });
  });

  it("leaves map_zoom omitted when not provided", () => {
    expect(normalizeEventLocationInput({ formatted_address: "x" }).map_zoom).toBeUndefined();
  });

  it("accepts allowlisted Google and Apple Maps URL overrides", () => {
    const result = normalizeEventLocationInput({
      google_maps_url_override: "  https://maps.app.goo.gl/abc123  ",
      apple_maps_url_override: "https://maps.apple.com/?ll=50,19",
    });
    expect(result.google_maps_url_override).toBe("https://maps.app.goo.gl/abc123");
    expect(result.apple_maps_url_override).toBe("https://maps.apple.com/?ll=50,19");
  });

  it("clears Maps URL overrides with empty string or null", () => {
    expect(normalizeEventLocationInput({ google_maps_url_override: "  " }).google_maps_url_override).toBeNull();
    expect(normalizeEventLocationInput({ apple_maps_url_override: null }).apple_maps_url_override).toBeNull();
  });

  it.each([
    ["http://www.google.com/maps", "https"],
    ["https://evil.example/maps", "Google Maps link"],
    ["https://www.google.com/search?q=venue", "Google Maps link"],
    ["https://www.google.com/", "Google Maps link"],
    ["not-a-url", "valid URL"],
    ["https://maps.google.com/" + "a".repeat(LOCATION_LIMITS.MAPS_URL_OVERRIDE_MAX_LENGTH), "at most"],
  ])("rejects invalid google_maps_url_override (%s)", (value, msgPart) => {
    expect(() => normalizeEventLocationInput({ google_maps_url_override: value })).toThrow(
      LocationValidationError,
    );
    try {
      normalizeEventLocationInput({ google_maps_url_override: value });
    } catch (err) {
      expect((err as Error).message).toContain(msgPart);
    }
  });

  it("accepts www.google.com only on /maps routes", () => {
    expect(
      normalizeEventLocationInput({
        google_maps_url_override: "https://www.google.com/maps/place/Hall",
      }).google_maps_url_override,
    ).toBe("https://www.google.com/maps/place/Hall");
    expect(
      normalizeEventLocationInput({
        google_maps_url_override: "https://www.google.com/maps/search/?api=1&query=1%2C2",
      }).google_maps_url_override,
    ).toBe("https://www.google.com/maps/search/?api=1&query=1%2C2");
  });

  it("rejects Apple override on a non-Apple host", () => {
    expect(() =>
      normalizeEventLocationInput({ apple_maps_url_override: "https://www.google.com/maps" }),
    ).toThrow(/Apple Maps link/);
  });
});

describe("assertCoordinatePairing", () => {
  it("allows both null", () => {
    expect(() => assertCoordinatePairing(null, null)).not.toThrow();
  });

  it("allows both set", () => {
    expect(() => assertCoordinatePairing(50.06, 19.94)).not.toThrow();
  });

  it("rejects latitude set without longitude", () => {
    expect(() => assertCoordinatePairing(50.06, null)).toThrow(LocationValidationError);
  });

  it("rejects longitude set without latitude", () => {
    expect(() => assertCoordinatePairing(null, 19.94)).toThrow(LocationValidationError);
  });
});
