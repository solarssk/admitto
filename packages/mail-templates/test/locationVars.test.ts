import { describe, expect, it } from "vitest";
import { buildEventLocationTemplateVars } from "../src/locationVars.js";

const LOCATION = {
  venue_name: "Hall",
  formatted_address: "1 Main St, City",
  address_components: {
    object_name: "Hall",
    street: "1 Main St",
    postcode: null,
    city: "City",
    region: null,
    country: "PL",
  },
  latitude: 50.06,
  longitude: 19.94,
  map_zoom: 16,
  directions_text: "North door",
  accessibility_text: "Step-free",
};

describe("buildEventLocationTemplateVars", () => {
  it("fills map image and navigation URLs when coordinates exist and maps are enabled", () => {
    const vars = buildEventLocationTemplateVars("evt-1", LOCATION, "https://tickets.example.com", {
      LOCATION_MAPS_ENABLED: "true",
    });
    expect(vars.event_location).toBe("Hall");
    expect(vars.event_map_url).toBe(
      "https://tickets.example.com/m/evt-1.png?v=2_50.060000_19.940000_z16",
    );
    expect(vars.google_maps_url).toContain("50.06");
    expect(vars.apple_maps_url).toContain("50.06");
    expect(vars.directions_text).toBe("North door");
    expect(vars.accessibility_text).toBe("Step-free");
    expect(vars.event_address).toContain("1 Main St");
  });

  it("omits event_map_url when LOCATION_MAPS_ENABLED=false but keeps Maps links", () => {
    const vars = buildEventLocationTemplateVars("evt-1", LOCATION, "https://tickets.example.com", {
      LOCATION_MAPS_ENABLED: "false",
    });
    expect(vars.event_map_url).toBe("");
    expect(vars.google_maps_url).toContain("google.com/maps");
    expect(vars.apple_maps_url).toContain("maps.apple.com");
  });

  it("omits all map fields when there are no coordinates", () => {
    const vars = buildEventLocationTemplateVars(
      "evt-1",
      { ...LOCATION, latitude: null, longitude: null },
      "https://tickets.example.com",
    );
    expect(vars.event_map_url).toBe("");
    expect(vars.google_maps_url).toBe("");
    expect(vars.apple_maps_url).toBe("");
    expect(vars.event_location).toBe("Hall");
  });
});
