import { describe, expect, it } from "vitest";
import { locationPinFields } from "../src/authorization.js";

describe("locationPinFields", () => {
  it("returns null pin fields when there is no location row", () => {
    expect(locationPinFields(null)).toEqual({
      location: null,
      has_coordinates: false,
      map_latitude: null,
      map_longitude: null,
      map_zoom: null,
    });
  });

  it("keeps venue name but clears pin fields when coordinates are incomplete", () => {
    expect(
      locationPinFields({
        venue_name: "Hall A",
        latitude: 52.23,
        longitude: null,
        map_zoom: 14,
      }),
    ).toEqual({
      location: "Hall A",
      has_coordinates: false,
      map_latitude: null,
      map_longitude: null,
      map_zoom: null,
    });
  });

  it("exposes pin fields when both coordinates are present", () => {
    expect(
      locationPinFields({
        venue_name: "Hall A",
        latitude: 52.23,
        longitude: 21.01,
        map_zoom: 14,
      }),
    ).toEqual({
      location: "Hall A",
      has_coordinates: true,
      map_latitude: 52.23,
      map_longitude: 21.01,
      map_zoom: 14,
    });
  });

  it("allows a full pin with null map_zoom", () => {
    expect(
      locationPinFields({
        venue_name: "Hall A",
        latitude: 52.23,
        longitude: 21.01,
        map_zoom: null,
      }).map_zoom,
    ).toBeNull();
  });
});
