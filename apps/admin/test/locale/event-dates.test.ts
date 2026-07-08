import { afterEach, describe, expect, it } from "vitest";
import {
  calendarDateInZone,
  formatAdmissionDisplay,
  formatEventDate,
  formatEventDateTime,
  formatEventTime,
  formatUtcDateTime,
  calendarDateValidationHint,
  localeDateInputPattern,
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

  it("parses year-first input as ISO order in day-first locales", () => {
    setPreferredLocale("pl-PL");
    expect(parseFlexibleCalendarDate("2026.3.15")).toBe("2026-03-15");
    expect(parseFlexibleCalendarDate("2026/3/15")).toBe("2026-03-15");
    expect(parseFlexibleCalendarDate("2026.07.15")).toBe("2026-07-15");
    expect(parseFlexibleCalendarDate("2026.3.7")).toBe("2026-03-07");
    expect(parseFlexibleCalendarDate("2026/3/7")).toBe("2026-03-07");
  });

  it("parses year-first input as ISO order in de-DE locale", () => {
    setPreferredLocale("de-DE");
    expect(parseFlexibleCalendarDate("2026.3.15")).toBe("2026-03-15");
    expect(parseFlexibleCalendarDate("2026-3-7")).toBe("2026-03-07");
  });

  it("rejects invalid calendar dates", () => {
    expect(parseFlexibleCalendarDate("2026-02-30")).toBeNull();
  });

  it("rejects chunks with non-numeric suffixes", () => {
    setPreferredLocale("pl-PL");
    expect(parseFlexibleCalendarDate("15a.07.2026")).toBeNull();
  });

  it("parses day-first when day is greater than 12", () => {
    setPreferredLocale("pl-PL");
    expect(parseFlexibleCalendarDate("15.01.2026")).toBe("2026-01-15");
  });

  it("rejects day and month values above 31", () => {
    setPreferredLocale("pl-PL");
    expect(parseFlexibleCalendarDate("32.32.2026")).toBeNull();
  });

  it("rejects year in the middle", () => {
    setPreferredLocale("en-US");
    expect(parseFlexibleCalendarDate("07/2026/15")).toBeNull();
  });
});

describe("localeDateInputPattern", () => {
  afterEach(() => setPreferredLocale(null));

  it("drops trailing locale punctuation for ko-KR", () => {
    setPreferredLocale("ko-KR");
    expect(localeDateInputPattern()).toBe("yyyy.mm.dd");
  });

  it("uses slashes for year-first ja-JP", () => {
    setPreferredLocale("ja-JP");
    expect(localeDateInputPattern()).toBe("yyyy/mm/dd");
  });
});

describe("calendarDateValidationHint", () => {
  it("omits hyphenated ISO hint for year-first patterns", () => {
    expect(calendarDateValidationHint("yyyy/mm/dd")).toBe("yyyy/mm/dd");
  });

  it("keeps ISO hint for day-first and month-first patterns", () => {
    expect(calendarDateValidationHint("dd.mm.yyyy")).toBe("dd.mm.yyyy or yyyy-mm-dd");
    expect(calendarDateValidationHint("mm/dd/yyyy")).toBe("mm/dd/yyyy or yyyy-mm-dd");
  });
});

describe("calendarDateInZone", () => {
  it("returns the calendar day in the given timezone", () => {
    // 23:30 UTC on 31 Jul is already 1 Aug in Warsaw (UTC+2 in summer).
    expect(calendarDateInZone("2026-07-31T23:30:00.000Z", "Europe/Warsaw")).toBe("2026-08-01");
    expect(calendarDateInZone("2026-07-31T23:30:00.000Z", "UTC")).toBe("2026-07-31");
  });
});

describe("formatAdmissionDisplay (#359)", () => {
  afterEach(() => setPreferredLocale(null));

  // Event.date is date-only stored as UTC noon.
  const EVENT_DATE = "2026-07-31T12:00:00.000Z";

  it("shows time only when admission is on the event calendar day", () => {
    setPreferredLocale("en-GB");
    const out = formatAdmissionDisplay("2026-07-31T07:44:00.000Z", EVENT_DATE, "Europe/Warsaw");
    expect(out).toMatch(/09:44/);
    expect(out).not.toMatch(/Jul|31/);
  });

  it("shows date and time for a test scan weeks before the event", () => {
    setPreferredLocale("en-GB");
    const out = formatAdmissionDisplay("2026-07-07T07:44:00.000Z", EVENT_DATE, "Europe/Warsaw");
    expect(out).toMatch(/07 Jul 2026/);
    expect(out).toMatch(/09:44/);
  });

  it("compares in the event timezone across midnight", () => {
    setPreferredLocale("en-GB");
    // 22:30 UTC on 30 Jul is 00:30 on 31 Jul in Warsaw — the event day.
    const out = formatAdmissionDisplay("2026-07-30T22:30:00.000Z", EVENT_DATE, "Europe/Warsaw");
    expect(out).not.toMatch(/Jul/);
  });

  it("falls back to date and time when the event date is unknown", () => {
    setPreferredLocale("en-GB");
    const out = formatAdmissionDisplay("2026-07-31T07:44:00.000Z", null, "Europe/Warsaw");
    expect(out).toMatch(/31 Jul 2026/);
  });

  it("defaults to UTC when no timezone is given", () => {
    setPreferredLocale("en-GB");
    // 07:44 UTC on the event day, no timezone passed — compares against UTC.
    const out = formatAdmissionDisplay("2026-07-31T07:44:00.000Z", EVENT_DATE);
    expect(out).toMatch(/07:44/);
    expect(out).toMatch(/UTC/);
  });
});
