import { describe, expect, it } from "vitest";
import {
  ATTENDEE_FIELD_PLACEHOLDERS,
  EVENT_FIELD_PLACEHOLDERS,
  isRelevantDateAffected,
  isVenueOrAddressFieldRelevant,
  isWalletFieldMappingRelevant,
  LOCATION_FIELD_PLACEHOLDERS,
  toPassCreatorData,
} from "../src/passcreator-mapper.js";
import type { WalletPassInput } from "../src/types.js";
import {
  WALLET_RELEVANT_ATTENDEE_FIELDS,
  WALLET_RELEVANT_EVENT_FIELDS,
  WALLET_RELEVANT_LOCATION_FIELDS,
} from "@admitto/shared";

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

  it("maps the venue/event-type/access-point-timing placeholders added for PassCreator's Semantic Tags vocabulary", () => {
    const data = toPassCreatorData(
      {
        ...baseInput,
        eventTypeLabel: "PKEventTypeConference",
        venueRoomLabel: "Hall B",
        venueEntranceLabel: "Main entrance",
        venueEntranceDoorLabel: "Door 3",
        venueEntranceGateLabel: "Gate B",
        venueEntrancePortalLabel: "North Portal",
        venuePhoneNumberLabel: "+91 80 4252 1000",
        venuePlaceIdLabel: "I4CCAB9B9CD77B6BA",
        venueOpenTimeLabel: "2026-08-10T08:00:00+02:00",
        venueCloseTimeLabel: "2026-08-10T23:00:00+02:00",
        doorsOpenTimeLabel: "2026-08-10T09:00:00+02:00",
        gatesOpenTimeLabel: "2026-08-10T09:30:00+02:00",
        boxOfficeOpenTimeLabel: "2026-08-10T08:30:00+02:00",
        parkingLotsOpenTimeLabel: "2026-08-10T07:00:00+02:00",
        fanZoneOpenTimeLabel: "2026-08-10T10:00:00+02:00",
      },
      "tmpl-1",
      {
        eventTypeField: "event_type",
        roomField: "venue_room",
        entranceField: "venue_entrance",
        doorField: "venue_entrance_door",
        gateField: "venue_entrance_gate",
        portalField: "venue_entrance_portal",
        phoneField: "venue_phone_number",
        placeIdField: "venue_place_id",
        venueOpenField: "venue_open_time",
        venueCloseField: "venue_close_time",
        doorsOpenField: "doors_open_time",
        gatesOpenField: "gates_open_time",
        boxOfficeOpenField: "box_office_open_time",
        parkingLotsOpenField: "parking_lots_open_time",
        fanZoneOpenField: "fan_zone_open_time",
      },
      true,
    );
    expect(data).toMatchObject({
      eventTypeField: "PKEventTypeConference",
      roomField: "Hall B",
      entranceField: "Main entrance",
      doorField: "Door 3",
      gateField: "Gate B",
      portalField: "North Portal",
      phoneField: "+91 80 4252 1000",
      placeIdField: "I4CCAB9B9CD77B6BA",
      venueOpenField: "2026-08-10T08:00:00+02:00",
      venueCloseField: "2026-08-10T23:00:00+02:00",
      doorsOpenField: "2026-08-10T09:00:00+02:00",
      gatesOpenField: "2026-08-10T09:30:00+02:00",
      boxOfficeOpenField: "2026-08-10T08:30:00+02:00",
      parkingLotsOpenField: "2026-08-10T07:00:00+02:00",
      fanZoneOpenField: "2026-08-10T10:00:00+02:00",
    });
  });

  it("never sends a semantics key (confirmed dead PassCreator API field, removed)", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1", undefined, true);
    expect(data).not.toHaveProperty("semantics");
  });

  describe("relevantDate", () => {
    it("omits the relevantDate key entirely when input.relevantDate is unset", () => {
      const data = toPassCreatorData(baseInput, "tmpl-1", undefined, true);
      expect(data).not.toHaveProperty("relevantDate");
    });

    it("sends relevantDate as a top-level sibling of base fields when present, regardless of fieldMapping", () => {
      const data = toPassCreatorData(
        { ...baseInput, relevantDate: "2026-08-10 18:00" },
        "tmpl-1",
        { mappedDate: "event_date" },
        true,
      );
      expect(data.mappedDate).toBe("10 August 2026");
      expect(data.relevantDate).toBe("2026-08-10 18:00");
      expect(data.templateId).toBe("tmpl-1");
    });
  });

});

describe("isWalletFieldMappingRelevant", () => {
  it("every WALLET_RELEVANT_EVENT_FIELDS/_LOCATION_FIELDS/_ATTENDEE_FIELDS entry has a table entry (no silent drift)", () => {
    for (const field of WALLET_RELEVANT_EVENT_FIELDS) expect(EVENT_FIELD_PLACEHOLDERS).toHaveProperty(field);
    for (const field of WALLET_RELEVANT_LOCATION_FIELDS) expect(LOCATION_FIELD_PLACEHOLDERS).toHaveProperty(field);
    for (const field of WALLET_RELEVANT_ATTENDEE_FIELDS) expect(ATTENDEE_FIELD_PLACEHOLDERS).toHaveProperty(field);
  });

  it("wallet_apple_enabled has no placeholder of its own - isWalletFieldMappingRelevant alone is always false for it, regardless of mapping", () => {
    expect(isWalletFieldMappingRelevant("wallet_apple_enabled", EVENT_FIELD_PLACEHOLDERS, null)).toBe(false);
    expect(isWalletFieldMappingRelevant("wallet_apple_enabled", EVENT_FIELD_PLACEHOLDERS, { any: "event_name" })).toBe(false);
  });

  it("is not relevant for a mapped-only field when fieldMapping is null/empty (e.g. event_type with no template field pointed at it)", () => {
    expect(isWalletFieldMappingRelevant("event_type", EVENT_FIELD_PLACEHOLDERS, null)).toBe(false);
    expect(isWalletFieldMappingRelevant("title", EVENT_FIELD_PLACEHOLDERS, {})).toBe(false);
    expect(isWalletFieldMappingRelevant("date", EVENT_FIELD_PLACEHOLDERS, null)).toBe(false);
    expect(isWalletFieldMappingRelevant("event_hours_start", EVENT_FIELD_PLACEHOLDERS, null)).toBe(false);
  });

  it("date and event_hours_start are relevant once event_date/event_hours is actually mapped", () => {
    expect(isWalletFieldMappingRelevant("date", EVENT_FIELD_PLACEHOLDERS, { d: "event_date" })).toBe(true);
    expect(isWalletFieldMappingRelevant("date", EVENT_FIELD_PLACEHOLDERS, { d: "event_date_short" })).toBe(true);
    expect(isWalletFieldMappingRelevant("event_hours_start", EVENT_FIELD_PLACEHOLDERS, { h: "event_hours" })).toBe(true);
  });

  it("date shares timezone's own event_hours/venue-access-time dependencies - it's the day every one of them is anchored to", () => {
    expect(isWalletFieldMappingRelevant("date", EVENT_FIELD_PLACEHOLDERS, { h: "event_hours" })).toBe(true);
    expect(isWalletFieldMappingRelevant("date", EVENT_FIELD_PLACEHOLDERS, { o: "venue_open_time" })).toBe(true);
    expect(isWalletFieldMappingRelevant("date", EVENT_FIELD_PLACEHOLDERS, { c: "venue_close_time" })).toBe(true);
    expect(isWalletFieldMappingRelevant("date", EVENT_FIELD_PLACEHOLDERS, { d: "doors_open_time" })).toBe(true);
    expect(isWalletFieldMappingRelevant("date", EVENT_FIELD_PLACEHOLDERS, { g: "gates_open_time" })).toBe(true);
    expect(isWalletFieldMappingRelevant("date", EVENT_FIELD_PLACEHOLDERS, { b: "box_office_open_time" })).toBe(true);
    expect(isWalletFieldMappingRelevant("date", EVENT_FIELD_PLACEHOLDERS, { p: "parking_lots_open_time" })).toBe(true);
    expect(isWalletFieldMappingRelevant("date", EVENT_FIELD_PLACEHOLDERS, { f: "fan_zone_open_time" })).toBe(true);
    expect(isWalletFieldMappingRelevant("date", EVENT_FIELD_PLACEHOLDERS, { n: "event_name" })).toBe(false);
  });

  it("is relevant once the field's placeholder is actually mapped", () => {
    expect(isWalletFieldMappingRelevant("event_type", EVENT_FIELD_PLACEHOLDERS, { kind: "event_type" })).toBe(true);
    expect(isWalletFieldMappingRelevant("title", EVENT_FIELD_PLACEHOLDERS, { name: "event_name" })).toBe(true);
  });

  it("is not relevant when fieldMapping only covers unrelated placeholders", () => {
    expect(isWalletFieldMappingRelevant("event_type", EVENT_FIELD_PLACEHOLDERS, { name: "event_name" })).toBe(false);
  });

  it("timezone is relevant when any of its several derived placeholders is mapped", () => {
    expect(isWalletFieldMappingRelevant("timezone", EVENT_FIELD_PLACEHOLDERS, { close: "venue_close_time" })).toBe(true);
    expect(isWalletFieldMappingRelevant("timezone", EVENT_FIELD_PLACEHOLDERS, { name: "event_name" })).toBe(false);
  });

  it("venue_name feeds event_location via the static table - google_maps_url/apple_maps_url are handled dynamically by isVenueOrAddressFieldRelevant instead", () => {
    expect(isWalletFieldMappingRelevant("venue_name", LOCATION_FIELD_PLACEHOLDERS, { place: "event_location" })).toBe(true);
    expect(isWalletFieldMappingRelevant("venue_name", LOCATION_FIELD_PLACEHOLDERS, { g: "google_maps_url" })).toBe(false);
  });

  it("formatted_address has no static placeholder at all - its google_maps_url/apple_maps_url relevance is entirely dynamic (isVenueOrAddressFieldRelevant)", () => {
    expect(isWalletFieldMappingRelevant("formatted_address", LOCATION_FIELD_PLACEHOLDERS, { g: "google_maps_url" })).toBe(false);
    expect(isWalletFieldMappingRelevant("formatted_address", LOCATION_FIELD_PLACEHOLDERS, { place: "event_location" })).toBe(false);
  });

  it("latitude/longitude are relevant only once a maps-url placeholder is mapped", () => {
    expect(isWalletFieldMappingRelevant("latitude", LOCATION_FIELD_PLACEHOLDERS, null)).toBe(false);
    expect(isWalletFieldMappingRelevant("latitude", LOCATION_FIELD_PLACEHOLDERS, { g: "google_maps_url" })).toBe(true);
  });

  it("venue_open_time also feeds venue_close_time's own placeholder (its value flips whether closing time lands on the next calendar day)", () => {
    expect(isWalletFieldMappingRelevant("venue_open_time", LOCATION_FIELD_PLACEHOLDERS, { o: "venue_open_time" })).toBe(true);
    expect(isWalletFieldMappingRelevant("venue_open_time", LOCATION_FIELD_PLACEHOLDERS, { c: "venue_close_time" })).toBe(true);
    expect(isWalletFieldMappingRelevant("venue_close_time", LOCATION_FIELD_PLACEHOLDERS, { o: "venue_open_time" })).toBe(false);
  });

  it("address_components also feeds event_date/event_date_short/event_hours (country-dependent formatting), alongside its own address placeholders", () => {
    expect(isWalletFieldMappingRelevant("address_components", LOCATION_FIELD_PLACEHOLDERS, { c: "country" })).toBe(true);
    expect(isWalletFieldMappingRelevant("address_components", LOCATION_FIELD_PLACEHOLDERS, { d: "event_date" })).toBe(true);
    expect(isWalletFieldMappingRelevant("address_components", LOCATION_FIELD_PLACEHOLDERS, { h: "event_hours" })).toBe(true);
    expect(isWalletFieldMappingRelevant("address_components", LOCATION_FIELD_PLACEHOLDERS, { n: "event_name" })).toBe(false);
  });

  it("email/company/department/ticket_type are a clean 1:1 mapping", () => {
    expect(isWalletFieldMappingRelevant("company", ATTENDEE_FIELD_PLACEHOLDERS, { c: "company" })).toBe(true);
    expect(isWalletFieldMappingRelevant("company", ATTENDEE_FIELD_PLACEHOLDERS, { d: "department" })).toBe(false);
  });

  it("first_name/last_name also feed full_name (Attendee.name is rebuilt from the pair on every split-name edit)", () => {
    expect(isWalletFieldMappingRelevant("first_name", ATTENDEE_FIELD_PLACEHOLDERS, { fn: "first_name" })).toBe(true);
    expect(isWalletFieldMappingRelevant("first_name", ATTENDEE_FIELD_PLACEHOLDERS, { n: "full_name" })).toBe(true);
    expect(isWalletFieldMappingRelevant("last_name", ATTENDEE_FIELD_PLACEHOLDERS, { n: "full_name" })).toBe(true);
    expect(isWalletFieldMappingRelevant("first_name", ATTENDEE_FIELD_PLACEHOLDERS, { d: "department" })).toBe(false);
  });

  it("fails open (relevant) for a field missing from the table entirely", () => {
    expect(isWalletFieldMappingRelevant("some_future_field", EVENT_FIELD_PLACEHOLDERS, null)).toBe(true);
  });
});

describe("isRelevantDateAffected", () => {
  it("is false when relevantDate is absent on both sides (no start time, mapping-independent false-positive this gate removes)", () => {
    expect(
      isRelevantDateAffected(
        { walletAppleEnabled: true, eventHoursStart: null },
        { walletAppleEnabled: true, eventHoursStart: null },
      ),
    ).toBe(false);
  });

  it("is false when Apple Wallet is off on both sides, even with a start time set", () => {
    expect(
      isRelevantDateAffected(
        { walletAppleEnabled: false, eventHoursStart: "18:00" },
        { walletAppleEnabled: false, eventHoursStart: "18:00" },
      ),
    ).toBe(false);
  });

  it("is true when relevantDate is present on both sides (a genuine content change, e.g. a new event date)", () => {
    expect(
      isRelevantDateAffected(
        { walletAppleEnabled: true, eventHoursStart: "18:00" },
        { walletAppleEnabled: true, eventHoursStart: "18:00" },
      ),
    ).toBe(true);
  });

  it("is true when relevantDate newly appears (start time added, or Apple Wallet newly enabled)", () => {
    expect(
      isRelevantDateAffected(
        { walletAppleEnabled: true, eventHoursStart: null },
        { walletAppleEnabled: true, eventHoursStart: "18:00" },
      ),
    ).toBe(true);
    expect(
      isRelevantDateAffected(
        { walletAppleEnabled: false, eventHoursStart: "18:00" },
        { walletAppleEnabled: true, eventHoursStart: "18:00" },
      ),
    ).toBe(true);
  });

  it("is true when relevantDate disappears (start time cleared, or Apple Wallet turned off)", () => {
    expect(
      isRelevantDateAffected(
        { walletAppleEnabled: true, eventHoursStart: "18:00" },
        { walletAppleEnabled: true, eventHoursStart: null },
      ),
    ).toBe(true);
    expect(
      isRelevantDateAffected(
        { walletAppleEnabled: true, eventHoursStart: "18:00" },
        { walletAppleEnabled: false, eventHoursStart: "18:00" },
      ),
    ).toBe(true);
  });
});

describe("isVenueOrAddressFieldRelevant", () => {
  const noOverride = { venueName: null, googleMapsUrlOverride: null, appleMapsUrlOverride: null };

  it("venue_name is relevant whenever event_location is mapped, independent of any map state", () => {
    expect(isVenueOrAddressFieldRelevant("venue_name", { place: "event_location" }, noOverride)).toBe(true);
  });

  it("venue_name is relevant to a mapped, non-overridden maps-url placeholder", () => {
    expect(isVenueOrAddressFieldRelevant("venue_name", { g: "google_maps_url" }, noOverride)).toBe(true);
    expect(isVenueOrAddressFieldRelevant("venue_name", { a: "apple_maps_url" }, noOverride)).toBe(true);
  });

  it("venue_name is not relevant to a maps-url placeholder once that platform has an override set (bot review)", () => {
    expect(
      isVenueOrAddressFieldRelevant("venue_name", { g: "google_maps_url" }, { ...noOverride, googleMapsUrlOverride: "https://maps.example/pinned" }),
    ).toBe(false);
  });

  it("venue_name relevance to google/apple maps-url is checked per platform, not all-or-nothing", () => {
    const state = { venueName: null, googleMapsUrlOverride: "https://maps.example/pinned", appleMapsUrlOverride: null };
    expect(isVenueOrAddressFieldRelevant("venue_name", { g: "google_maps_url" }, state)).toBe(false);
    expect(isVenueOrAddressFieldRelevant("venue_name", { a: "apple_maps_url" }, state)).toBe(true);
  });

  it("formatted_address is not relevant to a maps-url placeholder while venue_name is currently set (it's never read - venue_name wins)", () => {
    expect(
      isVenueOrAddressFieldRelevant("formatted_address", { g: "google_maps_url" }, { ...noOverride, venueName: "ICE Kraków" }),
    ).toBe(false);
  });

  it("formatted_address is relevant to a mapped, non-overridden maps-url placeholder once venue_name is empty", () => {
    expect(isVenueOrAddressFieldRelevant("formatted_address", { g: "google_maps_url" }, noOverride)).toBe(true);
  });

  it("formatted_address is never relevant to event_location (venue_name-only placeholder)", () => {
    expect(isVenueOrAddressFieldRelevant("formatted_address", { place: "event_location" }, noOverride)).toBe(false);
  });

  it("is not relevant at all when fieldMapping is null/empty", () => {
    expect(isVenueOrAddressFieldRelevant("venue_name", null, noOverride)).toBe(false);
    expect(isVenueOrAddressFieldRelevant("formatted_address", {}, noOverride)).toBe(false);
  });
});
