import { describe, expect, it } from "vitest";
import { buildBaseTemplateVars } from "../src/index.js";

const branding = { logo_url: "", header_image_url: "" };

describe("buildBaseTemplateVars", () => {
  it("uses location details when a map pin is saved", () => {
    const vars = buildBaseTemplateVars(
      {
        id: "evt-location",
        title: "Location event",
        date: new Date("2026-09-01"),
        location_details: {
          venue_name: "Sample venue",
          formatted_address: "Example Street 1, Warsaw",
          latitude: 52.2297,
          longitude: 21.0122,
          directions_text: "Enter through gate A.",
          accessibility_text: "Step-free access is available.",
        },
      },
      "UTC",
      branding,
      "https://tickets.example.com/",
    );

    expect(vars).toMatchObject({
      event_location: "Sample venue",
      event_map_url: "https://tickets.example.com/m/evt-location.png?v=5_52.229700_21.012200",
      event_address: "Example Street 1, Warsaw",
      directions_text: "Enter through gate A.",
      accessibility_text: "Step-free access is available.",
      google_maps_url:
        "https://www.google.com/maps/search/?api=1&query=Sample%20venue%4052.229700%2C21.012200",
      apple_maps_url: "https://maps.apple.com/?ll=52.229700%2C21.012200&q=Sample+venue",
    });
  });

  it("keeps optional location values empty without a complete map pin", () => {
    const vars = buildBaseTemplateVars(
      {
        id: "evt-no-map",
        title: "No map event",
        date: new Date("2026-09-01"),
        location_details: {
          venue_name: "Text-only venue",
          formatted_address: null,
          latitude: 52.2297,
          longitude: null,
          directions_text: null,
          accessibility_text: null,
        },
      },
      "UTC",
      branding,
      "https://tickets.example.com",
    );

    expect(vars).toMatchObject({
      event_location: "Text-only venue",
      event_map_url: "",
      event_address: "",
      directions_text: "",
      accessibility_text: "",
      google_maps_url: "",
      apple_maps_url: "",
    });
  });
});
