import { afterEach, describe, expect, it } from "vitest";
import {
  formatEventDate,
  formatEventDateTime,
  formatEventTime,
  formatUtcDateTime,
  parseFlexibleCalendarDate,
  utcDayEndIso,
  utcDayStartIso,
} from "../../src/utils/event-dates.js";
import { setPreferredLocale } from "../../src/utils/locale-store.js";

describe("formatEventDate with preferred locale", () => {
  afterEach(() => setPreferredLocale(null));

  const ISO = "2026-06-28T12:00:00.000Z";

  it("returns en-GB format when locale set to en-GB", () => {
    setPreferredLocale("en-GB");
    expect(formatEventDate(ISO, "Europe/Warsaw")).toBe("28 Jun 2026");
  });

  it("returns en-US format when locale set to en-US", () => {
    setPreferredLocale("en-US");
    expect(formatEventDate(ISO, "Europe/Warsaw")).toMatch(/Jun 28, 2026/);
  });

  it("returns pl-PL format when locale set to pl-PL", () => {
    setPreferredLocale("pl-PL");
    expect(formatEventDate(ISO, "Europe/Warsaw")).toMatch(/28[.\s]06[.\s]2026|28 cze 2026/);
  });

  it("falls back to browser locale when locale is null", () => {
    setPreferredLocale(null);
    expect(() => formatEventDate(ISO, "UTC")).not.toThrow();
  });

  it("respects event timezone with locale", () => {
    setPreferredLocale("en-GB");
    expect(formatEventDate("2026-06-28T15:00:00.000Z", "Asia/Tokyo")).toBe("29 Jun 2026");
  });
});

describe("formatEventDateTime and formatUtcDateTime", () => {
  afterEach(() => setPreferredLocale(null));

  it("formatEventDateTime shows event TZ abbreviation", () => {
    setPreferredLocale("en-GB");
    const result = formatEventDateTime("2026-06-28T13:00:00.000Z", "Europe/Warsaw");
    expect(result).toMatch(/28 Jun 2026/);
    expect(result).toMatch(/15:00/);
    expect(result).toMatch(/CEST|GMT\+2/);
  });

  it("formatUtcDateTime always shows UTC regardless of input TZ", () => {
    setPreferredLocale("en-GB");
    const result = formatUtcDateTime("2026-06-28T13:00:00.000Z");
    expect(result).toMatch(/28 Jun 2026/);
    expect(result).toMatch(/13:00/);
    expect(result).toMatch(/UTC/);
  });

  it("formatUtcDateTime is locale-aware (date format, not TZ)", () => {
    setPreferredLocale("pl-PL");
    const result = formatUtcDateTime("2026-06-28T13:00:00.000Z");
    expect(result).toMatch(/UTC/);
    expect(result).toMatch(/28/);
  });

  it("formatUtcDateTime shows UTC label even with null locale (browser default)", () => {
    setPreferredLocale(null);
    const result = formatUtcDateTime("2026-06-28T13:00:00.000Z");
    expect(result).toMatch(/UTC/);
    expect(result).toMatch(/28/);
    expect(result).toMatch(/2026/);
  });

  it("formatEventTime shows time and TZ abbreviation only", () => {
    setPreferredLocale("en-GB");
    const result = formatEventTime("2026-06-28T13:00:00.000Z", "Europe/Warsaw");
    expect(result).not.toMatch(/Jun 2026/);
    expect(result).toMatch(/15:00/);
    expect(result).toMatch(/CEST|GMT\+2/);
  });
});

describe("utcDayIso helpers", () => {
  it("utcDayStartIso and utcDayEndIso bound UTC calendar days", () => {
    expect(utcDayStartIso("2026-06-28")).toBe("2026-06-28T00:00:00.000Z");
    expect(utcDayEndIso("2026-06-28")).toBe("2026-06-28T23:59:59.999Z");
  });
});

describe("parseFlexibleCalendarDate", () => {
  afterEach(() => setPreferredLocale(null));

  it("parses ISO dates", () => {
    expect(parseFlexibleCalendarDate("2026-07-15")).toBe("2026-07-15");
  });

  it("parses day-first dates for pl-PL locale", () => {
    setPreferredLocale("pl-PL");
    expect(parseFlexibleCalendarDate("15.07.2026")).toBe("2026-07-15");
  });

  it("parses month-first dates for en-US locale", () => {
    setPreferredLocale("en-US");
    expect(parseFlexibleCalendarDate("07/15/2026")).toBe("2026-07-15");
  });

  it("parses year-first dates for ja-JP locale", () => {
    setPreferredLocale("ja-JP");
    expect(parseFlexibleCalendarDate("2026/07/08")).toBe("2026-07-08");
  });

  it("rejects invalid calendar dates", () => {
    expect(parseFlexibleCalendarDate("2026-02-30")).toBeNull();
  });

  it("rejects chunks with non-numeric suffixes", () => {
    setPreferredLocale("pl-PL");
    expect(parseFlexibleCalendarDate("15a.07.2026")).toBeNull();
  });

  it("rejects year in the middle", () => {
    setPreferredLocale("en-US");
    expect(parseFlexibleCalendarDate("07/2026/15")).toBeNull();
  });
});
