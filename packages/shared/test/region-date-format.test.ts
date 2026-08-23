import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateShort,
  formatEventHour,
  formatEventHoursRange,
  formatEventHoursRangeText,
} from "../src/region-date-format.js";

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

describe("formatDateShort", () => {
  it("abbreviates the month to a fixed 3 letters, day/month order following the region", () => {
    expect(formatDateShort(new Date("2026-09-24T12:00:00.000Z"))).toBe("24 Sep 2026");
    expect(formatDateShort(new Date("2026-09-24T12:00:00.000Z"), "United States")).toBe("Sep 24, 2026");
  });

  it("uses 'Sep', not CLDR en-GB's own 'Sept', for the default/fallback locale", () => {
    expect(formatDateShort(new Date("2026-09-24T12:00:00.000Z"))).not.toContain("Sept");
  });

  it("falls back to en-GB for a null or unrecognized country", () => {
    expect(formatDateShort(new Date("2026-01-01T12:00:00.000Z"), null)).toBe("1 Jan 2026");
    expect(formatDateShort(new Date("2026-01-01T12:00:00.000Z"), "Not A Real Country")).toBe("1 Jan 2026");
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

  it("converts to 12h am/pm for a US event, lowercased regardless of ICU's default casing", () => {
    expect(formatEventHour("09:00", "United States")).toBe("9:00 am");
    expect(formatEventHour("18:00", "United States")).toBe("6:00 pm");
    expect(formatEventHour("00:00", "United States")).toBe("12:00 am");
  });

  it("returns malformed input unchanged rather than guessing", () => {
    expect(formatEventHour("9am", "United States")).toBe("9am");
  });

  it("rejects out-of-range hour/minute values instead of letting Date.UTC normalize them", () => {
    expect(formatEventHour("24:00", "United States")).toBe("24:00");
    expect(formatEventHour("99:99", "United States")).toBe("99:99");
  });
});

describe("formatEventHoursRange", () => {
  it("resolves the zone abbreviation at the configured start hour, not the noon-UTC date sentinel", () => {
    // 2026-03-08 is the US spring-forward date: 00:30 America/New_York is still EST, even though
    // noon UTC that same day is already EDT (bot review: resolving from the date sentinel instead
    // of the configured hour showed "EDT" for a time that's actually still standard time).
    const range = formatEventHoursRange(
      "00:30",
      "03:00",
      null,
      "America/New_York",
      new Date("2026-03-08T12:00:00.000Z"),
    );
    expect(range?.tzAbbr).toBe("EST");
  });

  it("uses the end hour as the anchor when only an end bound is set", () => {
    const range = formatEventHoursRange(null, "03:00", null, "America/New_York", new Date("2026-03-08T12:00:00.000Z"));
    expect(range?.hours).toBe("until 03:00");
    expect(range?.tzAbbr).toBe("EDT");
  });

  it("falls back to the date sentinel without throwing for a timezone Intl doesn't recognize", () => {
    expect(() =>
      formatEventHoursRange("09:00", "18:00", null, "Not/AZone", new Date("2026-09-24T12:00:00.000Z")),
    ).not.toThrow();
    const range = formatEventHoursRange("09:00", "18:00", null, "Not/AZone", new Date("2026-09-24T12:00:00.000Z"));
    expect(range?.tzAbbr).toBeNull();
  });

  it("returns null when neither bound is set", () => {
    expect(formatEventHoursRange(null, null, null, "UTC", new Date("2026-09-24T12:00:00.000Z"))).toBeNull();
  });
});

describe("formatEventHoursRangeText", () => {
  it("folds the zone abbreviation into the same string", () => {
    const text = formatEventHoursRangeText(
      "09:00",
      "17:00",
      "United States",
      "America/New_York",
      new Date("2026-09-01T12:00:00.000Z"),
    );
    expect(text).toBe("9:00 am - 5:00 pm EDT");
  });

  it("omits the trailing space when the timezone has no resolvable abbreviation", () => {
    const text = formatEventHoursRangeText(
      "09:00",
      "18:00",
      null,
      "Not/AZone",
      new Date("2026-09-24T12:00:00.000Z"),
    );
    expect(text).toBe("09:00 - 18:00");
  });

  it("returns an empty string when neither bound is set", () => {
    expect(formatEventHoursRangeText(null, null, null, "UTC", new Date("2026-09-24T12:00:00.000Z"))).toBe("");
  });
});
