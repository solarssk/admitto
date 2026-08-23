import { describe, expect, it } from "vitest";
import { buildBaseTemplateVars, DEFAULT_SAMPLE_VARS, sanitizeSampleLinksForTestSend } from "../src/index.js";

const branding = { logo_url: "", header_image_url: "" };

describe("buildBaseTemplateVars", () => {
  it("uses location details when a map pin is saved", () => {
    const vars = buildBaseTemplateVars(
      {
        id: "evt-location",
        title: "Location event",
        date: new Date("2026-09-01"),
        timezone: "UTC",
        location_details: {
          venue_name: "Sample venue",
          formatted_address: "Example Street 1, Warsaw",
          latitude: 52.2297,
          longitude: 21.0122,
          directions_text: "Enter through gate A.",
          accessibility_text: "Step-free access is available.",
        },
      },
      branding,
      "https://tickets.example.com/",
    );

    expect(vars).toMatchObject({
      event_location: "Sample venue",
      event_map_url: "https://tickets.example.com/m/evt-location.png?v=9_52.229700_21.012200",
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
        timezone: "UTC",
        location_details: {
          venue_name: "Text-only venue",
          formatted_address: null,
          latitude: 52.2297,
          longitude: null,
          directions_text: null,
          accessibility_text: null,
        },
      },
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

  it("formats event_date/event_hours in the event's own regional convention, same as the ticket page", () => {
    const vars = buildBaseTemplateVars(
      {
        id: "evt-us",
        title: "US event",
        date: new Date("2026-09-01"),
        timezone: "America/New_York",
        event_hours_start: "09:00",
        event_hours_end: "17:00",
        location_details: {
          venue_name: "Sample venue",
          formatted_address: null,
          latitude: null,
          longitude: null,
          directions_text: null,
          accessibility_text: null,
          address_components: { country: "United States" },
        },
      },
      branding,
      "https://tickets.example.com/",
    );

    expect(vars.event_date).toBe("September 1, 2026");
    expect(vars.event_hours).toBe("9:00 am - 5:00 pm EDT");
  });

  it("uses en-GB 24h and no country/timezone suffix drift when no address is set", () => {
    const vars = buildBaseTemplateVars(
      {
        id: "evt-plain",
        title: "Plain event",
        date: new Date("2026-09-01"),
        timezone: "UTC",
        event_hours_start: "09:00",
        event_hours_end: "17:00",
      },
      branding,
      "https://tickets.example.com/",
    );

    expect(vars.event_date).toBe("1 September 2026");
    expect(vars.event_hours).toBe("09:00 - 17:00 UTC");
  });
});

describe("sanitizeSampleLinksForTestSend", () => {
  it("replaces the sample QR image and ticket link with placeholders that always render", () => {
    const rendered = {
      subject: "Your ticket",
      html: `<img src="${DEFAULT_SAMPLE_VARS.qr_image_url}"><a href="${DEFAULT_SAMPLE_VARS.ticket_url}">View ticket</a>`,
    };

    const sanitized = sanitizeSampleLinksForTestSend(rendered);

    expect(sanitized.subject).toBe(rendered.subject);
    expect(sanitized.html).toContain("data:image/svg+xml");
    expect(sanitized.html).toContain('href="#"');
    expect(sanitized.html).not.toContain(DEFAULT_SAMPLE_VARS.qr_image_url);
    expect(sanitized.html).not.toContain(DEFAULT_SAMPLE_VARS.ticket_url);
  });

  it("leaves html untouched when no sample URLs are present", () => {
    const rendered = {
      subject: "Your ticket",
      html: "<p>No sample links here.</p>",
    };

    expect(sanitizeSampleLinksForTestSend(rendered)).toEqual(rendered);
  });
});
