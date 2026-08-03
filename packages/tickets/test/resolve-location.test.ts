import { describe, expect, it } from "vitest";
import { parseTicketAddressComponents, toResolved } from "../src/resolve.js";

describe("parseTicketAddressComponents", () => {
  it("returns null for non-objects and empty grids", () => {
    expect(parseTicketAddressComponents(null)).toBeNull();
    expect(parseTicketAddressComponents("x")).toBeNull();
    expect(parseTicketAddressComponents([])).toBeNull();
    expect(parseTicketAddressComponents({ street: "  " })).toBeNull();
  });

  it("trims string fields and ignores non-strings", () => {
    expect(
      parseTicketAddressComponents({
        object_name: " Arena ",
        street: "Main 1",
        postcode: 12,
        city: "Warsaw",
        region: null,
        country: "Poland",
      }),
    ).toEqual({
      object_name: "Arena",
      street: "Main 1",
      postcode: null,
      city: "Warsaw",
      region: null,
      country: "Poland",
    });
  });
});

describe("toResolved location fields", () => {
  const baseAttendee = {
    id: "a1",
    event_id: "e1",
    email: "a@example.com",
    name: "Guest",
    status: "confirmed",
    token_hash: null,
    qr_payload: null,
    external_uuid: null,
    ticket_type: null,
  };

  it("maps location_details onto the ResolvedTicket event shape", () => {
    const resolved = toResolved(
      {
        ...baseAttendee,
        event: {
          id: "e1",
          title: "Launch",
          date: new Date("2026-09-01T09:00:00Z"),
          location_details: {
            venue_name: "Hall",
            formatted_address: "1 Main St, Warsaw",
            address_components: {
              street: "1 Main St",
              city: "Warsaw",
              country: "Poland",
            },
            latitude: 52.2,
            longitude: 21.0,
            map_zoom: 15,
            directions_text: "East gate",
            accessibility_text: "Step-free",
          },
          logo_url: null,
          header_image_url: null,
          organization: { logo_url: null, header_image_url: null },
        },
      },
      "internal",
    );

    expect(resolved.event.location).toBe("Hall");
    expect(resolved.event.formattedAddress).toBe("1 Main St, Warsaw");
    expect(resolved.event.addressComponents?.street).toBe("1 Main St");
    expect(resolved.event.latitude).toBe(52.2);
    expect(resolved.event.mapZoom).toBe(15);
    expect(resolved.event.directionsText).toBe("East gate");
    expect(resolved.event.accessibilityText).toBe("Step-free");
    expect(resolved.event.googleMapsUrlOverride).toBeNull();
    expect(resolved.event.appleMapsUrlOverride).toBeNull();
  });

  it("maps Maps URL overrides onto the ResolvedTicket event shape", () => {
    const resolved = toResolved(
      {
        ...baseAttendee,
        event: {
          id: "e1",
          title: "Launch",
          date: new Date("2026-09-01T09:00:00Z"),
          location_details: {
            venue_name: "Hall",
            formatted_address: "1 Main St, Warsaw",
            address_components: null,
            latitude: 52.2,
            longitude: 21.0,
            map_zoom: 15,
            directions_text: null,
            accessibility_text: null,
            google_maps_url_override: "https://www.google.com/maps/place/Hall",
            apple_maps_url_override: "https://maps.apple.com/?q=Hall",
          },
          logo_url: null,
          header_image_url: null,
          organization: { logo_url: null, header_image_url: null },
        },
      },
      "internal",
    );
    expect(resolved.event.googleMapsUrlOverride).toBe("https://www.google.com/maps/place/Hall");
    expect(resolved.event.appleMapsUrlOverride).toBe("https://maps.apple.com/?q=Hall");
  });

  it("leaves location fields null when location_details is absent", () => {
    const resolved = toResolved(
      {
        ...baseAttendee,
        event: {
          id: "e1",
          title: "Launch",
          date: new Date("2026-09-01T09:00:00Z"),
          location_details: null,
          logo_url: null,
          header_image_url: null,
          organization: { logo_url: null, header_image_url: null },
        },
      },
      "internal",
    );
    expect(resolved.event.location).toBeNull();
    expect(resolved.event.addressComponents).toBeNull();
    expect(resolved.event.mapZoom).toBeNull();
  });
});
