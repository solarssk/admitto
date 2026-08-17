import { afterEach, describe, expect, it } from "vitest";
import {
  formatEventDate,
  formatEventHours,
  resolvePreviewEventTimeZone,
} from "../src/formatEventDate.js";

describe("formatEventDate", () => {
  it("formats calendar day in the given timezone, not UTC slice", () => {
    // 2026-10-01 00:00 in Europe/Warsaw (CEST, UTC+2)
    const instant = new Date("2026-09-30T22:00:00.000Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(formatEventDate(instant, "Europe/Warsaw")).toBe("2026-10-01");
    expect(formatEventDate(instant, "UTC")).toBe("2026-09-30");
  });

  it("returns YYYY-MM-DD for UTC noon events", () => {
    expect(formatEventDate(new Date("2026-09-01T12:00:00.000Z"), "UTC")).toBe("2026-09-01");
  });

  it("uses timezone calendar day for offset boundary timestamps", () => {
    const instant = new Date("2026-09-01T00:30:00+02:00");
    expect(formatEventDate(instant, "Europe/Warsaw")).toBe("2026-09-01");
    expect(formatEventDate(instant, "UTC")).toBe("2026-08-31");
  });

  it("falls back to UTC for invalid timezone strings", () => {
    const instant = new Date("2026-09-01T12:00:00.000Z");
    expect(formatEventDate(instant, "Not/A_Timezone")).toBe("2026-09-01");
  });
});

describe("formatEventHours", () => {
  it("joins both bounds as HH:MM-HH:MM", () => {
    expect(formatEventHours("10:00", "17:00")).toBe("10:00-17:00");
  });

  it("returns empty string when either bound is missing", () => {
    expect(formatEventHours(null, "17:00")).toBe("");
    expect(formatEventHours("10:00", null)).toBe("");
    expect(formatEventHours(undefined, undefined)).toBe("");
  });
});

describe("resolvePreviewEventTimeZone", () => {
  const original = process.env.ADMITTO_DEFAULT_EVENT_TIMEZONE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ADMITTO_DEFAULT_EVENT_TIMEZONE;
    } else {
      process.env.ADMITTO_DEFAULT_EVENT_TIMEZONE = original;
    }
  });

  it("returns explicit valid timezone", () => {
    expect(resolvePreviewEventTimeZone("Europe/Warsaw")).toBe("Europe/Warsaw");
  });

  it("falls back to UTC for invalid explicit or env timezone", () => {
    expect(resolvePreviewEventTimeZone("bogus/tz")).toBe("UTC");
    process.env.ADMITTO_DEFAULT_EVENT_TIMEZONE = "bogus/tz";
    expect(resolvePreviewEventTimeZone()).toBe("UTC");
  });
});
