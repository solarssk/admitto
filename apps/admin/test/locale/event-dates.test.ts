import { afterEach, describe, expect, it } from "vitest";
import {
  formatEventDate,
  formatEventDateTime,
  formatUtcDateTime,
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
});
