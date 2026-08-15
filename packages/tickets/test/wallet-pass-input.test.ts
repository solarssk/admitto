import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { buildWalletPassInput, formatDate, resolveTicketPageDisplay } from "../src/wallet-pass-input.js";
import { formatEventHour } from "../src/region-date-format.js";

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
      // Matches the DB defaults (wallet_apple_enabled true, wallet_semantic_tags_enabled false) -
      // semantics stays off unless a test explicitly opts in, so the "all fields present" exact
      // match below doesn't need to account for it.
      walletAppleEnabled: true,
      walletSemanticTagsEnabled: false,
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

describe("formatDate", () => {
  it("formats as en-GB long-month text when no country is given (default/fallback)", () => {
    expect(formatDate(new Date("2026-09-24T12:00:00.000Z"))).toBe("24 September 2026");
  });

  it("stays on the UTC calendar day at both ends of it, not a process-local one", () => {
    expect(formatDate(new Date("2026-01-01T00:00:00.000Z"))).toBe("1 January 2026");
    expect(formatDate(new Date("2026-01-01T23:59:59.000Z"))).toBe("1 January 2026");
  });

  it("falls back to en-GB for a null or missing country", () => {
    expect(formatDate(new Date("2026-09-24T12:00:00.000Z"), null)).toBe("24 September 2026");
    expect(formatDate(new Date("2026-09-24T12:00:00.000Z"), undefined)).toBe("24 September 2026");
  });

  it("falls back to en-GB for a country name it doesn't recognize", () => {
    expect(formatDate(new Date("2026-09-24T12:00:00.000Z"), "Not A Real Country")).toBe("24 September 2026");
  });

  it("switches to US-style month/day/year for a US event, English words throughout", () => {
    expect(formatDate(new Date("2026-09-24T12:00:00.000Z"), "United States")).toBe("September 24, 2026");
  });

  it("stays en-GB style for other 24h-convention countries (e.g. Germany, Poland)", () => {
    expect(formatDate(new Date("2026-09-24T12:00:00.000Z"), "Germany")).toBe("24 September 2026");
    expect(formatDate(new Date("2026-09-24T12:00:00.000Z"), "Poland")).toBe("24 September 2026");
  });
});

describe("formatEventHour", () => {
  it("keeps the raw zero-padded 24h value for the default/fallback locale", () => {
    expect(formatEventHour("09:00")).toBe("09:00");
    expect(formatEventHour("18:00")).toBe("18:00");
    expect(formatEventHour("00:05")).toBe("00:05");
  });

  it("falls back to 24h for a null or unrecognized country", () => {
    expect(formatEventHour("09:00", null)).toBe("09:00");
    expect(formatEventHour("09:00", "Not A Real Country")).toBe("09:00");
  });

  it("converts to 12h AM/PM for a US event", () => {
    expect(formatEventHour("09:00", "United States")).toBe("9:00 AM");
    expect(formatEventHour("18:00", "United States")).toBe("6:00 PM");
    expect(formatEventHour("00:00", "United States")).toBe("12:00 AM");
  });

  it("returns malformed input unchanged rather than guessing", () => {
    expect(formatEventHour("9am", "United States")).toBe("9am");
  });

  it("rejects out-of-range hour/minute values instead of letting Date.UTC normalize them", () => {
    expect(formatEventHour("24:00", "United States")).toBe("24:00");
    expect(formatEventHour("99:99", "United States")).toBe("99:99");
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
      eventHoursLabel: "09:00-18:00",
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

  it("omits event hours when only one bound is set - a half-set range isn't shown", () => {
    const startOnly = buildWalletPassInput(fullResolved({ event: { eventHoursEnd: null } }), "b");
    const endOnly = buildWalletPassInput(fullResolved({ event: { eventHoursStart: null } }), "b");

    expect(startOnly.eventHoursLabel).toBeUndefined();
    expect(endOnly.eventHoursLabel).toBeUndefined();
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
    expect(input.eventHoursLabel).toBe("9:00 AM-6:00 PM");
  });
});

describe("buildWalletPassInput — Apple Wallet semantic tags (opt-in)", () => {
  it("omits semantics entirely when walletSemanticTagsEnabled is off (the DB default)", () => {
    const input = buildWalletPassInput(fullResolved(), "b");
    expect(input.semantics).toBeUndefined();
  });

  it("omits semantics when walletAppleEnabled is off, even if the tags toggle is on", () => {
    const input = buildWalletPassInput(
      fullResolved({ event: { walletSemanticTagsEnabled: true, walletAppleEnabled: false } }),
      "b",
    );
    expect(input.semantics).toBeUndefined();
  });

  it("populates semantics from event/attendee data when both toggles are on", () => {
    const input = buildWalletPassInput(
      fullResolved({ event: { walletSemanticTagsEnabled: true } }),
      "b",
    );
    expect(input.semantics).toEqual({
      eventName: "Admitto Conference",
      eventType: "PKEventTypeGeneric",
      // Europe/London is BST (+01:00) in September.
      eventStartDate: "2026-09-24T09:00:00+01:00",
      eventEndDate: "2026-09-24T18:00:00+01:00",
      venueName: "Main Hall",
      venueLocation: { latitude: 51.5, longitude: -0.1 },
      entranceDescription: "Enter via the north gate",
      attendeeName: "Jane Doe",
      duration: 9 * 60 * 60,
    });
  });

  it("omits venueLocation when coordinates aren't ready, without dropping the rest", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: { walletSemanticTagsEnabled: true, latitude: null, longitude: null },
      }),
      "b",
    );
    expect(input.semantics?.venueLocation).toBeUndefined();
    expect(input.semantics?.eventName).toBe("Admitto Conference");
  });

  it("omits eventStartDate/eventEndDate/duration when event hours aren't set", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: { walletSemanticTagsEnabled: true, eventHoursStart: null, eventHoursEnd: null },
      }),
      "b",
    );
    expect(input.semantics?.eventStartDate).toBeUndefined();
    expect(input.semantics?.eventEndDate).toBeUndefined();
    expect(input.semantics?.duration).toBeUndefined();
    expect(input.semantics?.eventName).toBe("Admitto Conference");
  });

  it("sets eventStartDate but leaves eventEndDate/duration undefined when only the start hour is set", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: { walletSemanticTagsEnabled: true, eventHoursStart: "09:00", eventHoursEnd: null },
      }),
      "b",
    );
    expect(input.semantics?.eventStartDate).toBeDefined();
    expect(input.semantics?.eventEndDate).toBeUndefined();
    expect(input.semantics?.duration).toBeUndefined();
  });

  it("treats a malformed event-hours string as unset rather than producing a bad instant", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: { walletSemanticTagsEnabled: true, eventHoursStart: "9am", eventHoursEnd: "18:00" },
      }),
      "b",
    );
    expect(input.semantics?.eventStartDate).toBeUndefined();
  });

  it("omits duration (rather than 0) for an event whose start and end hours are identical", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: { walletSemanticTagsEnabled: true, eventHoursStart: "09:00", eventHoursEnd: "09:00" },
      }),
      "b",
    );
    expect(input.semantics?.duration).toBeUndefined();
  });

  it("omits eventName/venueName/entranceDescription/attendeeName when their source values are empty", () => {
    const input = buildWalletPassInput(
      fullResolved({
        attendee: { name: "" },
        event: { walletSemanticTagsEnabled: true, title: "", location: "", directionsText: "" },
      }),
      "b",
    );
    expect(input.semantics?.eventName).toBeUndefined();
    expect(input.semantics?.venueName).toBeUndefined();
    expect(input.semantics?.entranceDescription).toBeUndefined();
    expect(input.semantics?.attendeeName).toBeUndefined();
  });

  it("wraps an overnight event's duration past midnight instead of going negative", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: { walletSemanticTagsEnabled: true, eventHoursStart: "22:00", eventHoursEnd: "02:00" },
      }),
      "b",
    );
    expect(input.semantics?.duration).toBe(4 * 60 * 60);
  });

  it("rolls eventEndDate onto the next calendar day for an overnight event, so it stays after eventStartDate", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: {
          walletSemanticTagsEnabled: true,
          timezone: "UTC",
          eventHoursStart: "22:00",
          eventHoursEnd: "02:00",
        },
      }),
      "b",
    );
    expect(input.semantics?.eventStartDate).toBe("2026-09-24T22:00:00Z");
    expect(input.semantics?.eventEndDate).toBe("2026-09-25T02:00:00Z");
    expect(new Date(input.semantics!.eventEndDate!).getTime()).toBeGreaterThan(
      new Date(input.semantics!.eventStartDate!).getTime(),
    );
  });

  it("keeps eventEndDate on the same calendar day for a normal (non-overnight) event", () => {
    const input = buildWalletPassInput(fullResolved({ event: { walletSemanticTagsEnabled: true } }), "b");
    // Europe/London (fullResolved's default timezone) is BST (+01:00) in September.
    expect(input.semantics?.eventStartDate).toBe("2026-09-24T09:00:00+01:00");
    expect(input.semantics?.eventEndDate).toBe("2026-09-24T18:00:00+01:00");
  });

  it("computes a UTC offset ('Z') correctly for a UTC-timezone event", () => {
    const input = buildWalletPassInput(
      fullResolved({ event: { walletSemanticTagsEnabled: true, timezone: "UTC" } }),
      "b",
    );
    expect(input.semantics?.eventStartDate).toBe("2026-09-24T09:00:00Z");
  });

  it("keeps the stored calendar day for a UTC+14 event, even though noon UTC there is already the next local day", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: { walletSemanticTagsEnabled: true, timezone: "Pacific/Kiritimati" },
      }),
      "b",
    );
    expect(input.semantics?.eventStartDate).toBe("2026-09-24T09:00:00+14:00");
  });

  it("resolves the offset at the event's own local time, not the day's noon-UTC sentinel (DST transition day)", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: {
          walletSemanticTagsEnabled: true,
          date: new Date("2026-03-29T12:00:00.000Z"),
          timezone: "Europe/London",
          eventHoursStart: "00:30",
          eventHoursEnd: "03:00",
        },
      }),
      "b",
    );
    // UK clocks spring forward 01:00 GMT -> 02:00 BST on 2026-03-29 - 00:30 local is still GMT
    // even though noon UTC that same day is already BST (the bug this guards against).
    expect(input.semantics?.eventStartDate).toBe("2026-03-29T00:30:00Z");
    expect(input.semantics?.eventEndDate).toBe("2026-03-29T03:00:00+01:00");
  });

  it("computes duration from real elapsed time across a DST transition, not a wall-clock hour count", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: {
          walletSemanticTagsEnabled: true,
          date: new Date("2026-03-28T12:00:00.000Z"),
          timezone: "Europe/London",
          eventHoursStart: "22:00",
          eventHoursEnd: "02:00",
        },
      }),
      "b",
    );
    // 2026-03-28 22:00 GMT to 2026-03-29 02:00 BST is 3 real hours (clocks sprang forward at
    // 01:00 GMT), not the 4 wall-clock hours naive HH:MM subtraction would give.
    expect(input.semantics?.duration).toBe(3 * 60 * 60);
  });

  it("resolves each bound's own offset on a spring-forward date in a non-zero-standard-offset zone (same-day event straddling the transition)", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: {
          walletSemanticTagsEnabled: true,
          date: new Date("2026-03-08T12:00:00.000Z"),
          timezone: "America/New_York",
          eventHoursStart: "01:00",
          eventHoursEnd: "03:00",
        },
      }),
      "b",
    );
    // America/New_York springs forward on 2026-03-08 (02:00 EST -> 03:00 EDT): 01:00 is still
    // EST (-05:00, real instant 06:00Z), 03:00 is already EDT (-04:00, real instant 07:00Z) - a
    // real 1-hour local span, not the 2 hours a "treat the wall-clock digits as UTC, probe the
    // offset once" approximation used to compute for both bounds landing on the same
    // pre-transition side.
    expect(input.semantics?.eventStartDate).toBe("2026-03-08T01:00:00-05:00");
    expect(input.semantics?.eventEndDate).toBe("2026-03-08T03:00:00-04:00");
    expect(input.semantics?.duration).toBe(1 * 60 * 60);
  });

  it("emits the resolved instant, not a stale-digits recombination, when eventHoursStart falls inside a spring-forward gap", () => {
    const input = buildWalletPassInput(
      fullResolved({
        event: {
          walletSemanticTagsEnabled: true,
          date: new Date("2026-03-08T12:00:00.000Z"),
          timezone: "America/New_York",
          eventHoursStart: "02:30",
          eventHoursEnd: "09:00",
        },
      }),
      "b",
    );
    // 02:30 doesn't exist on 2026-03-08 in America/New_York (clocks skip 2:00-3:00am) -
    // zonedWallClockToUtcIso resolves it to the nearest valid instant, 03:30 EDT (07:30Z).
    // Recombining that offset with the original "02:30" digits would emit
    // "2026-03-08T02:30:00-04:00", which parses as 06:30Z - a full hour off from the instant
    // actually resolved and a different, wrong value from what the naive pre-fix code emitted too.
    expect(input.semantics?.eventStartDate).toBe("2026-03-08T07:30:00.000Z");
    expect(new Date(input.semantics!.eventStartDate!).toISOString()).toBe("2026-03-08T07:30:00.000Z");
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
        fullResolved({
          event: { walletSemanticTagsEnabled: true, timezone: "America/New_York" },
        }),
        "b",
      );
      expect(input.semantics?.eventStartDate).toBe("2026-09-24T09:00:00Z");
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
        fullResolved({
          event: { walletSemanticTagsEnabled: true, timezone: "America/New_York" },
        }),
        "b",
      );
      expect(input.semantics?.eventStartDate).toBe("2026-09-24T09:00:00Z");
    });
  });
});
