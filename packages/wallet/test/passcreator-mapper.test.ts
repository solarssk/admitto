import { describe, expect, it } from "vitest";
import { toPassCreatorData } from "../src/passcreator-mapper.js";
import type { WalletPassInput } from "../src/types.js";

const baseInput: WalletPassInput = {
  attendeeName: "Alice Admin",
  eventDateLabel: "10 August 2026",
  eventDateShortLabel: "10 Aug 2026",
  ticketTypeLabel: "VIP",
  userProvidedId: "admitto:evt-1:att-1",
  barcodeValue: "https://tickets.example.com/t/tok-1",
};

describe("toPassCreatorData", () => {
  it("always includes barcodeValue, matching the ticket page's own QR payload", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1", undefined, true);
    expect(data.barcodeValue).toBe("https://tickets.example.com/t/tok-1");
  });

  it("includes barcodeValue even when a custom field mapping is used", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1", { attendeeFullName: "full_name" }, true);
    expect(data.barcodeValue).toBe("https://tickets.example.com/t/tok-1");
  });

  it("also exposes the ticket/QR URL as a mappable ticket_url placeholder", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1", { barcodeSource: "ticket_url" }, true);
    expect(data.barcodeSource).toBe("https://tickets.example.com/t/tok-1");
  });

  it("sends only base fields (templateId, userProvidedId, barcodeValue) when fieldMapping is omitted", () => {
    const data = toPassCreatorData(
      { ...baseInput, eventHoursLabel: "18:00-22:00", eventLocationLabel: "Test Venue" },
      "tmpl-1",
      undefined,
      true,
    );
    expect(data).toEqual({
      templateId: "tmpl-1",
      userProvidedId: "admitto:evt-1:att-1",
      enforceUniqueUserProvidedId: true,
      barcodeValue: "https://tickets.example.com/t/tok-1",
    });
  });

  it("sets enforceUniqueUserProvidedId to false when enforceUnique is false (update, not create)", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1", undefined, false);
    expect(data.enforceUniqueUserProvidedId).toBe(false);
  });

  it("sends only base fields when fieldMapping is an empty object", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1", {}, true);
    expect(data).not.toHaveProperty("name");
    expect(data).not.toHaveProperty("eventDate");
  });

  it("sends exactly the fields listed in fieldMapping, nothing more", () => {
    const data = toPassCreatorData(
      { ...baseInput, eventHoursLabel: "18:00-22:00", eventLocationLabel: "Test Venue" },
      "tmpl-1",
      { attendeeFullName: "full_name", ticketKind: "ticket_type" },
      true,
    );
    expect(data).toMatchObject({
      templateId: "tmpl-1",
      userProvidedId: "admitto:evt-1:att-1",
      attendeeFullName: "Alice Admin",
      ticketKind: "VIP",
    });
    expect(data).not.toHaveProperty("name");
    expect(data).not.toHaveProperty("eventDate");
    expect(data).not.toHaveProperty("eventHours");
    expect(data).not.toHaveProperty("eventPlace");
  });

  it("includes a mapped field's value when the corresponding label is set", () => {
    const data = toPassCreatorData(
      { ...baseInput, eventHoursLabel: "18:00-22:00", eventLocationLabel: "Test Venue" },
      "tmpl-1",
      { hours: "event_hours", place: "event_location" },
      true,
    );
    expect(data.hours).toBe("18:00-22:00");
    expect(data.place).toBe("Test Venue");
  });

  it("drops a mapped field whose source value is unset", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1", { hours: "event_hours" }, true);
    expect(data).not.toHaveProperty("hours");
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
      true,
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

  it("maps event_date_short alongside the existing long event_date placeholder", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1", { dateLong: "event_date", dateShort: "event_date_short" }, true);
    expect(data.dateLong).toBe("10 August 2026");
    expect(data.dateShort).toBe("10 Aug 2026");
  });

  describe("relevantDate", () => {
    it("omits the relevantDate key entirely when input.relevantDate is unset", () => {
      const data = toPassCreatorData(baseInput, "tmpl-1", undefined, true);
      expect(data).not.toHaveProperty("relevantDate");
    });

    it("sends relevantDate as a top-level sibling of base fields when present, regardless of fieldMapping", () => {
      const data = toPassCreatorData({ ...baseInput, relevantDate: "2026-08-10 18:00" }, "tmpl-1", undefined, true);
      expect(data.relevantDate).toBe("2026-08-10 18:00");
      expect(data.templateId).toBe("tmpl-1");
    });
  });

  describe("Apple Wallet semantics", () => {
    const semantics = {
      eventName: "Launch Event",
      eventType: "PKEventTypeGeneric",
      eventStartDate: "2026-08-10T18:00:00+02:00",
      venueName: "Test Arena",
    };

    it("omits the semantics key entirely when input.semantics is unset", () => {
      const data = toPassCreatorData(baseInput, "tmpl-1", undefined, true);
      expect(data).not.toHaveProperty("semantics");
    });

    it("omits the semantics key when input.semantics is an empty object", () => {
      const data = toPassCreatorData({ ...baseInput, semantics: {} }, "tmpl-1", undefined, true);
      expect(data).not.toHaveProperty("semantics");
    });

    it("sends semantics as a top-level sibling of base fields, verbatim", () => {
      const data = toPassCreatorData({ ...baseInput, semantics }, "tmpl-1", undefined, true);
      expect(data.semantics).toEqual(semantics);
      expect(data.templateId).toBe("tmpl-1");
      expect(data.barcodeValue).toBe("https://tickets.example.com/t/tok-1");
    });

    it("keeps semantics alongside an admin's own fieldMapping custom properties", () => {
      const data = toPassCreatorData(
        { ...baseInput, semantics, eventNameLabel: "Launch Event" },
        "tmpl-1",
        { name: "event_name" },
        true,
      );
      expect(data.semantics).toEqual(semantics);
      expect(data.name).toBe("Launch Event");
    });
  });
});
