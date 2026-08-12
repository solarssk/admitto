import { describe, expect, it } from "vitest";
import { toPassCreatorData } from "../src/passcreator-mapper.js";
import type { WalletPassInput } from "../src/types.js";

const baseInput: WalletPassInput = {
  attendeeName: "Alice Admin",
  eventDateLabel: "2026-08-10",
  ticketTypeLabel: "VIP",
  userProvidedId: "admitto:evt-1:att-1",
  barcodeValue: "https://tickets.example.com/t/tok-1",
};

describe("toPassCreatorData", () => {
  it("always includes barcodeValue, matching the ticket page's own QR payload", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1");
    expect(data.barcodeValue).toBe("https://tickets.example.com/t/tok-1");
  });

  it("includes barcodeValue even when a custom field mapping is used", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1", { attendeeFullName: "full_name" });
    expect(data.barcodeValue).toBe("https://tickets.example.com/t/tok-1");
  });

  it("also exposes the ticket/QR URL as a mappable ticket_url placeholder", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1", { barcodeSource: "ticket_url" });
    expect(data.barcodeSource).toBe("https://tickets.example.com/t/tok-1");
  });

  it("includes eventHours and eventPlace when both labels are provided", () => {
    const data = toPassCreatorData(
      { ...baseInput, eventHoursLabel: "18:00-22:00", eventLocationLabel: "Test Venue" },
      "tmpl-1",
    );
    expect(data.eventHours).toBe("18:00-22:00");
    expect(data.eventPlace).toBe("Test Venue");
  });

  it("omits eventHours and eventPlace when both labels are absent", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1");
    expect(data).not.toHaveProperty("eventHours");
    expect(data).not.toHaveProperty("eventPlace");
  });

  it("uses an admin field mapping instead of the default keys when provided", () => {
    const data = toPassCreatorData(
      { ...baseInput, eventHoursLabel: "18:00-22:00", eventLocationLabel: "Test Venue" },
      "tmpl-1",
      { attendeeFullName: "full_name", ticketKind: "ticket_type" },
    );
    expect(data).toMatchObject({
      templateId: "tmpl-1",
      userProvidedId: "admitto:evt-1:att-1",
      attendeeFullName: "Alice Admin",
      ticketKind: "VIP",
    });
    expect(data).not.toHaveProperty("name");
    expect(data).not.toHaveProperty("eventDate");
  });

  it("drops a mapped field whose source value is unset", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1", { hours: "event_hours" });
    expect(data).not.toHaveProperty("hours");
  });

  it("falls back to the default mapping when fieldMapping is empty", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1", {});
    expect(data.name).toBe("Alice Admin");
  });

  it("maps the expanded placeholder vocabulary (name parts, event/address, maps links)", () => {
    const data = toPassCreatorData(
      {
        ...baseInput,
        attendeeFirstNameLabel: "Alice",
        attendeeLastNameLabel: "Admin",
        attendeeEmailLabel: "alice@example.com",
        attendeeCompanyLabel: "Acme",
        attendeeDepartmentLabel: "Engineering",
        eventNameLabel: "Launch Event",
        directionsTextLabel: "Enter via the north gate.",
        accessibilityTextLabel: "Step-free access.",
        googleMapsUrlLabel: "https://maps.google.com/?q=1,2",
        appleMapsUrlLabel: "https://maps.apple.com/?ll=1,2",
        addressObjectNameLabel: "Test Arena",
        addressStreetLabel: "Main 1",
        addressPostcodeLabel: "00-001",
        addressCityLabel: "Warsaw",
        addressRegionLabel: "Mazovia",
        addressCountryLabel: "Poland",
      },
      "tmpl-1",
      {
        first: "first_name",
        last: "last_name",
        mail: "email",
        org: "company",
        dept: "department",
        name: "event_name",
        directions: "directions_text",
        access: "accessibility_text",
        gmaps: "google_maps_url",
        amaps: "apple_maps_url",
        venue: "object_name",
        street: "street",
        zip: "postcode",
        city: "city",
        region: "region",
        country: "country",
      },
    );
    expect(data).toMatchObject({
      first: "Alice",
      last: "Admin",
      mail: "alice@example.com",
      org: "Acme",
      dept: "Engineering",
      name: "Launch Event",
      directions: "Enter via the north gate.",
      access: "Step-free access.",
      gmaps: "https://maps.google.com/?q=1,2",
      amaps: "https://maps.apple.com/?ll=1,2",
      venue: "Test Arena",
      street: "Main 1",
      zip: "00-001",
      city: "Warsaw",
      region: "Mazovia",
      country: "Poland",
    });
  });
});
