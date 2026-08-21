import { describe, expect, it } from "vitest";
import { getTimeZone, getTimeZoneAbbreviationForDate, getTimeZones, normalizeTimeZone } from "../src/timezones.js";

describe("timezones", () => {
  it("normalizes legacy IANA links to one preferred identifier", () => {
    expect(normalizeTimeZone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(normalizeTimeZone("Europe/Kiev")).toBe("Europe/Kyiv");
  });

  it("uses one display definition for a preferred identifier and its legacy alias", () => {
    expect(getTimeZone("Asia/Kolkata")).toEqual(getTimeZone("Asia/Calcutta"));
    expect(getTimeZone("Asia/Calcutta")?.iana).toBe("Asia/Kolkata");
  });

  it("keeps UTC as the preferred zero-offset identifier", () => {
    expect(normalizeTimeZone("Etc/UTC")).toBe("UTC");
    expect(getTimeZones().some((zone) => zone.iana === "UTC")).toBe(true);
    expect(getTimeZones().some((zone) => zone.iana === "Factory")).toBe(false);
  });

  it("keeps distinct IANA zones distinct when their display metadata is grouped", () => {
    expect(normalizeTimeZone("America/Dawson_Creek")).toBe("America/Dawson_Creek");
    expect(normalizeTimeZone("America/Fort_Nelson")).toBe("America/Fort_Nelson");
    expect(getTimeZone("America/Dawson_Creek")?.iana).toBe("America/Dawson_Creek");
  });

  it("does not rewrite an identifier absent from the bundled IANA catalogue", () => {
    expect(normalizeTimeZone("Legacy/Removed")).toBeNull();
    expect(getTimeZone("Legacy/Removed")).toBeNull();
  });

  it("exposes the zone's standard-time abbreviation", () => {
    expect(getTimeZone("Asia/Kolkata")?.abbreviation).toBe("IST");
    expect(getTimeZone("Europe/Warsaw")?.abbreviation).toBe("CET");
    expect(getTimeZone("UTC")?.abbreviation).toBe("UTC");
  });

  describe("getTimeZoneAbbreviationForDate", () => {
    it("switches between standard and daylight abbreviations for a zone ICU renders as letters", () => {
      expect(getTimeZoneAbbreviationForDate("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe("EST");
      expect(getTimeZoneAbbreviationForDate("America/New_York", new Date("2026-07-15T12:00:00Z"))).toBe("EDT");
    });

    it("uses the tzdb abbreviation only when the date is actually in standard time", () => {
      // Europe/Warsaw: ICU has no letter form ("GMT+1"/"GMT+2"), so this falls back to tzdb's
      // "CET" in January (correct - not DST) but must NOT show "CET" in July (DST, +2 not +1).
      expect(getTimeZoneAbbreviationForDate("Europe/Warsaw", new Date("2026-01-15T12:00:00Z"))).toBe("CET");
      expect(getTimeZoneAbbreviationForDate("Europe/Warsaw", new Date("2026-07-15T12:00:00Z"))).not.toBe("CET");
      expect(getTimeZoneAbbreviationForDate("Europe/Warsaw", new Date("2026-07-15T12:00:00Z"))).toBe("GMT+2");
    });

    it("handles a southern-hemisphere zone where DST runs opposite the northern-hemisphere months", () => {
      // Australia/Sydney is in daylight saving in January (southern summer), not July.
      expect(getTimeZoneAbbreviationForDate("Australia/Sydney", new Date("2026-01-15T12:00:00Z"))).not.toBe("AEST");
      expect(getTimeZoneAbbreviationForDate("Australia/Sydney", new Date("2026-07-15T12:00:00Z"))).toBe("AEST");
    });

    it("returns the same abbreviation year-round for a zone that never observes DST", () => {
      expect(getTimeZoneAbbreviationForDate("Asia/Kolkata", new Date("2026-01-15T12:00:00Z"))).toBe("IST");
      expect(getTimeZoneAbbreviationForDate("Asia/Kolkata", new Date("2026-07-15T12:00:00Z"))).toBe("IST");
    });

    it("resolves a legacy alias before looking up the abbreviation", () => {
      expect(getTimeZoneAbbreviationForDate("Asia/Calcutta", new Date("2026-07-15T12:00:00Z"))).toBe("IST");
    });

    it("returns UTC as-is and null for an unrecognized zone", () => {
      expect(getTimeZoneAbbreviationForDate("UTC", new Date("2026-07-15T12:00:00Z"))).toBe("UTC");
      expect(getTimeZoneAbbreviationForDate("Legacy/Removed", new Date("2026-07-15T12:00:00Z"))).toBeNull();
    });
  });
});
