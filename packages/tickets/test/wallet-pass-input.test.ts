import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { buildWalletPassInput, resolveTicketPageDisplay } from "../src/wallet-pass-input.js";

function makeResolved(ticketType: string | null) {
  return {
    attendee: { ticket_type: ticketType },
    event: { id: "evt-1" },
  } as unknown as Parameters<typeof resolveTicketPageDisplay>[1];
}

function makeDb(ticketTypeFindMany: () => Promise<unknown>): PrismaClient {
  return { ticketType: { findMany: ticketTypeFindMany } } as unknown as PrismaClient;
}

/** Every field buildWalletPassInput reads, present - individual tests null out what they need to
 * exercise the other branch. Field names match resolve.ts's toResolved() output shape exactly. */
function fullResolved(overrides: { attendee?: Record<string, unknown>; event?: Record<string, unknown> } = {}) {
  return {
    attendee: {
      id: "att-1",
      name: "Jane Doe",
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      company: "Acme",
      department: "Engineering",
      ticket_type: "vip",
      ...overrides.attendee,
    },
    event: {
      id: "evt-1",
      title: "Admitto Conference",
      date: new Date("2026-09-24T12:00:00.000Z"),
      timezone: "Europe/London",
      eventHoursStart: "09:00",
      eventHoursEnd: "18:00",
      location: "Main Hall",
      formattedAddress: "123 Example St, London",
      directionsText: "Enter via the north gate",
      accessibilityText: "Step-free access",
      latitude: 51.5,
      longitude: -0.1,
      googleMapsUrlOverride: null,
      appleMapsUrlOverride: null,
      walletAppleEnabled: true,
      addressComponents: {
        object_name: "Main Hall",
        street: "123 Example St",
        postcode: "AB1 2CD",
        city: "London",
        region: "Greater London",
        country: "United Kingdom",
      },
      ...overrides.event,
    },
  } as unknown as Parameters<typeof buildWalletPassInput>[0];
}

describe("resolveTicketPageDisplay — ticket type label resolution edge cases", () => {
  it("skips the catalog lookup entirely when the attendee has no ticket_type", async () => {
    const findMany = vi.fn();
    const db = makeDb(findMany);
    const resolved = makeResolved(null);

    const result = await resolveTicketPageDisplay(db, resolved);

    expect(result).toBe(resolved);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("substitutes the catalog label for the raw ticket_type key when a match is found", async () => {
    const db = makeDb(() => Promise.resolve([{ key: "press_pass", label: "Press Pass" }]));
    const resolved = makeResolved("press_pass");

    const result = await resolveTicketPageDisplay(db, resolved);

    expect(result.attendee.ticket_type).toBe("Press Pass");
  });

  it("returns the resolved ticket unchanged when the catalog has no matching key", async () => {
    const db = makeDb(() => Promise.resolve([{ key: "vip", label: "VIP" }]));
    const resolved = makeResolved("press_pass");

    const result = await resolveTicketPageDisplay(db, resolved);

    expect(result.attendee.ticket_type).toBe("press_pass");
  });

  it("fails open to the raw ticket type when loadEventTicketTypes throws", async () => {
    const db = makeDb(() => Promise.reject(new Error("db down")));
    const resolved = makeResolved("press_pass");

    const result = await resolveTicketPageDisplay(db, resolved);

    expect(result.attendee.ticket_type).toBe("press_pass");
  });
});

describe("buildWalletPassInput", () => {
  it("maps every optional field through when all are present, including computed map links", () => {
    const input = buildWalletPassInput(fullResolved(), "barcode-123");

    expect(input).toEqual({
      attendeeName: "Jane Doe",
      attendeeFirstNameLabel: "Jane",
      attendeeLastNameLabel: "Doe",
      attendeeEmailLabel: "jane@example.com",
      attendeeCompanyLabel: "Acme",
      attendeeDepartmentLabel: "Engineering",
      eventNameLabel: "Admitto Conference",
      eventDateLabel: "24 September 2026",
      eventDateShortLabel: "24 Sep 2026",
      eventHoursLabel: "09:00 - 18:00 GMT+1",
      eventLocationLabel: "Main Hall",
      directionsTextLabel: "Enter via the north gate",
      accessibilityTextLabel: "Step-free access",
      googleMapsUrlLabel: expect.stringContaining("google"),
      appleMapsUrlLabel: expect.stringContaining("maps.apple"),
      addressObjectNameLabel: "Main Hall",
      addressStreetLabel: "123 Example St",
      addressPostcodeLabel: "AB1 2CD",
      addressCityLabel: "London",
      addressRegionLabel: "Greater London",
      addressCountryLabel: "United Kingdom",
      ticketTypeLabel: "vip",
      userProvidedId: "admitto:evt-1:att-1",
      barcodeValue: "barcode-123",
      relevantDate: "2026-09-24 09:00",
    });
  });

  it("leaves every optional field undefined when the underlying data is absent", () => {
    const resolved = fullResolved({
      attendee: {
        first_name: null,
        last_name: null,
        email: null,
        company: null,
        department: null,
        ticket_type: null,
      },
      event: {
        eventHoursStart: null,
        eventHoursEnd: null,
        location: null,
        formattedAddress: null,
        directionsText: null,
        accessibilityText: null,
        latitude: null,
        longitude: null,
        addressComponents: null,
      },
    });

    const input = buildWalletPassInput(resolved, "barcode-123");

    expect(input).toMatchObject({
      attendeeFirstNameLabel: undefined,
      attendeeLastNameLabel: undefined,
      attendeeEmailLabel: undefined,
      attendeeCompanyLabel: undefined,
      attendeeDepartmentLabel: undefined,
      eventHoursLabel: undefined,
      eventLocationLabel: undefined,
      directionsTextLabel: undefined,
      accessibilityTextLabel: undefined,
      googleMapsUrlLabel: undefined,
      appleMapsUrlLabel: undefined,
      addressObjectNameLabel: undefined,
      addressStreetLabel: undefined,
      addressPostcodeLabel: undefined,
      addressCityLabel: undefined,
      addressRegionLabel: undefined,
      addressCountryLabel: undefined,
      ticketTypeLabel: "General",
    });
  });

  it("shows an open-ended 'from'/'until' when only one bound is set, matching the ticket page", () => {
    const startOnly = buildWalletPassInput(fullResolved({ event: { eventHoursEnd: null } }), "b");
    const endOnly = buildWalletPassInput(fullResolved({ event: { eventHoursStart: null } }), "b");

    expect(startOnly.eventHoursLabel).toBe("from 09:00 GMT+1");
    expect(endOnly.eventHoursLabel).toBe("until 18:00 GMT+1");
  });

  it("prefers an explicit map URL override over the computed link", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: {
          googleMapsUrlOverride: "https://maps.example/google-override",
          appleMapsUrlOverride: "https://maps.example/apple-override",
        },
      }),
      "b",
    );

    expect(input.googleMapsUrlLabel).toBe("https://maps.example/google-override");
    expect(input.appleMapsUrlLabel).toBe("https://maps.example/apple-override");
  });

  it("falls back to formattedAddress as the map label when location is unset", () => {
    // Only observable indirectly (the label feeds the computed URL, not a field of its own) -
    // asserting the URL is still produced confirms the ?? fallback chain didn't short-circuit.
    const input = buildWalletPassInput(fullResolved({ event: { location: null } }), "b");

    expect(input.googleMapsUrlLabel).toEqual(expect.stringContaining("google"));
  });

  it("formats eventDateLabel/eventHoursLabel for the event's own country (US-style, not en-GB)", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: {
          addressComponents: {
            object_name: "Main Hall",
            street: "123 Example St",
            postcode: "10001",
            city: "New York",
            region: "NY",
            country: "United States",
          },
        },
      }),
      "b",
    );

    expect(input.eventDateLabel).toBe("September 24, 2026");
    expect(input.eventDateShortLabel).toBe("Sep 24, 2026");
    expect(input.eventHoursLabel).toBe("9:00 am - 6:00 pm GMT+1");
  });
});

describe("buildWalletPassInput — relevantDate (PassCreator Lock Screen surfacing)", () => {
  it("sends the event's local wall-clock digits", () => {
    const input = buildWalletPassInput(fullResolved(), "b");
    expect(input.relevantDate).toBe("2026-09-24 09:00");
  });

  it("is omitted when walletAppleEnabled is off", () => {
    const input = buildWalletPassInput(fullResolved({ event: { walletAppleEnabled: false } }), "b");
    expect(input.relevantDate).toBeUndefined();
  });

  it("is omitted when there's no start time to anchor it to", () => {
    const input = buildWalletPassInput(fullResolved({ event: { eventHoursStart: null } }), "b");
    expect(input.relevantDate).toBeUndefined();
  });
});

describe("buildWalletPassInput — event type placeholder", () => {
  it("translates a known event_type DB key to its Apple PKEventType literal", () => {
    const input = buildWalletPassInput(fullResolved({ event: { eventType: "sports" } }), "b");
    expect(input.eventTypeLabel).toBe("PKEventTypeSports");
  });

  it.each([
    ["generic", "PKEventTypeGeneric"],
    ["live_performance", "PKEventTypeLivePerformance"],
    ["movie", "PKEventTypeMovie"],
    ["conference", "PKEventTypeConference"],
    ["convention", "PKEventTypeConvention"],
    ["workshop", "PKEventTypeWorkshop"],
    ["social_gathering", "PKEventTypeSocialGathering"],
  ])("translates %s to %s", (key, apple) => {
    const input = buildWalletPassInput(fullResolved({ event: { eventType: key } }), "b");
    expect(input.eventTypeLabel).toBe(apple);
  });

  it("leaves eventTypeLabel undefined when event_type is not set", () => {
    const input = buildWalletPassInput(fullResolved({ event: { eventType: null } }), "b");
    expect(input.eventTypeLabel).toBeUndefined();
  });
});

describe("buildWalletPassInput — venue identifier placeholders", () => {
  it("passes through each venue identifier field when set", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: {
          venueRoom: "Hall B",
          venueEntrance: "Main entrance",
          venueEntranceDoor: "Door 3",
          venueEntranceGate: "Gate B",
          venueEntrancePortal: "North Portal",
          venuePhoneNumber: "+91 80 4252 1000",
          venuePlaceId: "I4CCAB9B9CD77B6BA",
        },
      }),
      "b",
    );
    expect(input.venueRoomLabel).toBe("Hall B");
    expect(input.venueEntranceLabel).toBe("Main entrance");
    expect(input.venueEntranceDoorLabel).toBe("Door 3");
    expect(input.venueEntranceGateLabel).toBe("Gate B");
    expect(input.venueEntrancePortalLabel).toBe("North Portal");
    expect(input.venuePhoneNumberLabel).toBe("+91 80 4252 1000");
    expect(input.venuePlaceIdLabel).toBe("I4CCAB9B9CD77B6BA");
  });

  it("leaves every venue identifier label undefined when unset", () => {
    const input = buildWalletPassInput(fullResolved(), "b");
    expect(input.venueRoomLabel).toBeUndefined();
    expect(input.venueEntranceLabel).toBeUndefined();
    expect(input.venueEntranceDoorLabel).toBeUndefined();
    expect(input.venueEntranceGateLabel).toBeUndefined();
    expect(input.venueEntrancePortalLabel).toBeUndefined();
    expect(input.venuePhoneNumberLabel).toBeUndefined();
    expect(input.venuePlaceIdLabel).toBeUndefined();
  });
});

// The 7 access-point timing placeholders all go through the same zonedDateTimeToIso helper as
// the old eventStartDate/eventEndDate semantic tags did - venueOpenTime/venueOpenTimeLabel is
// exercised here as the representative field for its DST/ICU edge cases rather than duplicating
// every case across all 7 (they share the exact same code path). venueCloseTime is the one
// exception: like the old eventEndDate, it carries the same overnight-rollover logic (its own
// test below), since a venue's closing time is the field structurally analogous to when the
// event itself ends - the other 6 are all pre-event and stay anchored to event.date as-is.
describe("buildWalletPassInput — access-point timing placeholders", () => {
  it("populates all 7 timing labels from their event fields", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: {
          venueOpenTime: "08:00",
          venueCloseTime: "23:00",
          doorsOpenTime: "08:30",
          gatesOpenTime: "08:45",
          boxOfficeOpenTime: "08:15",
          parkingLotsOpenTime: "07:00",
          fanZoneOpenTime: "09:00",
        },
      }),
      "b",
    );
    // Europe/London (fullResolved's default timezone) is BST (+01:00) in September.
    expect(input.venueOpenTimeLabel).toBe("2026-09-24T08:00:00+01:00");
    expect(input.venueCloseTimeLabel).toBe("2026-09-24T23:00:00+01:00");
    expect(input.doorsOpenTimeLabel).toBe("2026-09-24T08:30:00+01:00");
    expect(input.gatesOpenTimeLabel).toBe("2026-09-24T08:45:00+01:00");
    expect(input.boxOfficeOpenTimeLabel).toBe("2026-09-24T08:15:00+01:00");
    expect(input.parkingLotsOpenTimeLabel).toBe("2026-09-24T07:00:00+01:00");
    expect(input.fanZoneOpenTimeLabel).toBe("2026-09-24T09:00:00+01:00");
  });

  it("leaves a timing label undefined when its event field is unset", () => {
    const input = buildWalletPassInput(fullResolved({ event: { venueOpenTime: null } }), "b");
    expect(input.venueOpenTimeLabel).toBeUndefined();
  });

  it("rolls venue_close_time to the next calendar day for an overnight event", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: { eventHoursStart: "20:00", eventHoursEnd: "01:00", venueCloseTime: "01:30" },
      }),
      "b",
    );
    // event.date is 2026-09-24; eventHoursEnd (01:00) < eventHoursStart (20:00) marks this
    // overnight, so venue_close_time anchors to 2026-09-25, not the event's own stored day.
    expect(input.venueCloseTimeLabel).toBe("2026-09-25T01:30:00+01:00");
  });

  it("keeps venue_close_time on the event's own day when the event isn't overnight", () => {
    const input = buildWalletPassInput(
      fullResolved({ event: { eventHoursStart: "09:00", eventHoursEnd: "18:00", venueCloseTime: "19:00" } }),
      "b",
    );
    expect(input.venueCloseTimeLabel).toBe("2026-09-24T19:00:00+01:00");
  });

  it("does not roll the other 6 access-point times for an overnight event - they stay pre-event, same day", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: {
          eventHoursStart: "20:00",
          eventHoursEnd: "01:00",
          venueOpenTime: "18:00",
          doorsOpenTime: "19:00",
          gatesOpenTime: "19:15",
          boxOfficeOpenTime: "18:30",
          parkingLotsOpenTime: "17:00",
          fanZoneOpenTime: "19:30",
        },
      }),
      "b",
    );
    expect(input.venueOpenTimeLabel).toBe("2026-09-24T18:00:00+01:00");
    expect(input.doorsOpenTimeLabel).toBe("2026-09-24T19:00:00+01:00");
    expect(input.gatesOpenTimeLabel).toBe("2026-09-24T19:15:00+01:00");
    expect(input.boxOfficeOpenTimeLabel).toBe("2026-09-24T18:30:00+01:00");
    expect(input.parkingLotsOpenTimeLabel).toBe("2026-09-24T17:00:00+01:00");
    expect(input.fanZoneOpenTimeLabel).toBe("2026-09-24T19:30:00+01:00");
  });

  it("treats a malformed time string as unset rather than producing a bad instant", () => {
    const input = buildWalletPassInput(fullResolved({ event: { venueOpenTime: "9am" } }), "b");
    expect(input.venueOpenTimeLabel).toBeUndefined();
  });

  it("computes a UTC offset ('Z') correctly for a UTC-timezone event", () => {
    const input = buildWalletPassInput(
      fullResolved({ event: { timezone: "UTC", venueOpenTime: "09:00" } }),
      "b",
    );
    expect(input.venueOpenTimeLabel).toBe("2026-09-24T09:00:00Z");
  });

  it("keeps the stored calendar day for a UTC+14 event, even though noon UTC there is already the next local day", () => {
    const input = buildWalletPassInput(
      fullResolved({ event: { timezone: "Pacific/Kiritimati", venueOpenTime: "09:00" } }),
      "b",
    );
    expect(input.venueOpenTimeLabel).toBe("2026-09-24T09:00:00+14:00");
  });

  it("resolves the offset at the event's own local time, not the day's noon-UTC sentinel (DST transition day)", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: {
          date: new Date("2026-03-29T12:00:00.000Z"),
          timezone: "Europe/London",
          venueOpenTime: "00:30",
        },
      }),
      "b",
    );
    // UK clocks spring forward 01:00 GMT -> 02:00 BST on 2026-03-29 - 00:30 local is still GMT
    // even though noon UTC that same day is already BST (the bug this guards against).
    expect(input.venueOpenTimeLabel).toBe("2026-03-29T00:30:00Z");
  });

  it("resolves each field's own offset independently on a spring-forward date in a non-zero-standard-offset zone", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: {
          date: new Date("2026-03-08T12:00:00.000Z"),
          timezone: "America/New_York",
          venueOpenTime: "01:00",
          doorsOpenTime: "03:00",
        },
      }),
      "b",
    );
    // America/New_York springs forward on 2026-03-08 (02:00 EST -> 03:00 EDT): 01:00 is still
    // EST (-05:00), 03:00 is already EDT (-04:00) - each field resolves its own instant
    // independently, no shared "probe the offset once for both" approximation.
    expect(input.venueOpenTimeLabel).toBe("2026-03-08T01:00:00-05:00");
    expect(input.doorsOpenTimeLabel).toBe("2026-03-08T03:00:00-04:00");
  });

  it("emits the resolved instant, not a stale-digits recombination, when a time falls inside a spring-forward gap", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: {
          date: new Date("2026-03-08T12:00:00.000Z"),
          timezone: "America/New_York",
          venueOpenTime: "02:30",
        },
      }),
      "b",
    );
    // 02:30 doesn't exist on 2026-03-08 in America/New_York (clocks skip 2:00-3:00am) -
    // zonedWallClockToUtcIso resolves it to the nearest valid instant, 03:30 EDT (07:30Z).
    // Recombining that offset with the original "02:30" digits would emit
    // "2026-03-08T02:30:00-04:00", which parses as 06:30Z - a full hour off from the instant
    // actually resolved.
    expect(input.venueOpenTimeLabel).toBe("2026-03-08T07:30:00.000Z");
    expect(new Date(input.venueOpenTimeLabel!).toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  describe("tzOffsetSuffix ICU data variance", () => {
    afterEach(() => vi.restoreAllMocks());

    it("falls back to Z when the offset formatter omits the timeZoneName part entirely", () => {
      const real = Intl.DateTimeFormat.prototype.formatToParts;
      vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(function (
        this: Intl.DateTimeFormat,
        ...args
      ) {
        const parts = real.apply(this, args);
        return this.resolvedOptions().timeZoneName ? parts.filter((p) => p.type !== "timeZoneName") : parts;
      });
      const input = buildWalletPassInput(
        fullResolved({ event: { timezone: "America/New_York", venueOpenTime: "09:00" } }),
        "b",
      );
      expect(input.venueOpenTimeLabel).toBe("2026-09-24T09:00:00Z");
    });

    it("falls back to Z when the offset formatter returns a string that doesn't match the GMT±HH:MM shape", () => {
      const real = Intl.DateTimeFormat.prototype.formatToParts;
      vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(function (
        this: Intl.DateTimeFormat,
        ...args
      ) {
        const parts = real.apply(this, args);
        if (!this.resolvedOptions().timeZoneName) return parts;
        return parts.map((p) => (p.type === "timeZoneName" ? { ...p, value: "???" } : p));
      });
      const input = buildWalletPassInput(
        fullResolved({ event: { timezone: "America/New_York", venueOpenTime: "09:00" } }),
        "b",
      );
      expect(input.venueOpenTimeLabel).toBe("2026-09-24T09:00:00Z");
    });
  });

  describe("localWallClockReading ICU data variance", () => {
    afterEach(() => vi.restoreAllMocks());

    // localWallClockReading's own Intl.DateTimeFormat call is the only one in this flow with
    // hour/minute but no second and no timeZoneName - zonedWallClockToUtcIso's internal probe
    // always requests seconds too, tzOffsetSuffix always requests timeZoneName instead.
    function isLocalWallClockReadingCall(format: Intl.DateTimeFormat): boolean {
      const resolved = format.resolvedOptions();
      return resolved.hour !== undefined && resolved.second === undefined && !resolved.timeZoneName;
    }

    it("treats an ICU build reporting midnight as hour '24' the same as '00'", () => {
      const real = Intl.DateTimeFormat.prototype.formatToParts;
      vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(function (
        this: Intl.DateTimeFormat,
        ...args
      ) {
        const parts = real.apply(this, args);
        if (!isLocalWallClockReadingCall(this)) return parts;
        return parts.map((p) => (p.type === "hour" && p.value === "00" ? { ...p, value: "24" } : p));
      });
      const input = buildWalletPassInput(
        fullResolved({ event: { timezone: "UTC", venueOpenTime: "00:00" } }),
        "b",
      );
      expect(input.venueOpenTimeLabel).toBe("2026-09-24T00:00:00Z");
    });

    it("defaults a missing hour/minute part to '00' rather than throwing", () => {
      const real = Intl.DateTimeFormat.prototype.formatToParts;
      vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(function (
        this: Intl.DateTimeFormat,
        ...args
      ) {
        const parts = real.apply(this, args);
        return isLocalWallClockReadingCall(this) ? parts.filter((p) => p.type !== "minute") : parts;
      });
      // With "minute" stripped, localWallClockReading reads back "09:00" (its own fallback) for
      // an actual 09:00 request - matches, so this doesn't trip the skipped-time fallback path;
      // asserts the defensive default doesn't throw or corrupt the (still correct here) result.
      const input = buildWalletPassInput(
        fullResolved({ event: { timezone: "America/New_York", venueOpenTime: "09:00" } }),
        "b",
      );
      expect(input.venueOpenTimeLabel).toBe("2026-09-24T09:00:00-04:00");
    });

    it("defaults a missing hour part to '00' rather than throwing", () => {
      const real = Intl.DateTimeFormat.prototype.formatToParts;
      vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(function (
        this: Intl.DateTimeFormat,
        ...args
      ) {
        const parts = real.apply(this, args);
        return isLocalWallClockReadingCall(this) ? parts.filter((p) => p.type !== "hour") : parts;
      });
      // With "hour" stripped, localWallClockReading reads back "00:00" for a UTC midnight
      // request - matches, so this stays on the normal (non-fallback) path too.
      const input = buildWalletPassInput(
        fullResolved({ event: { timezone: "UTC", venueOpenTime: "00:00" } }),
        "b",
      );
      expect(input.venueOpenTimeLabel).toBe("2026-09-24T00:00:00Z");
    });
  });
});
