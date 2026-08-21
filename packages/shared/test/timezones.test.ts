import { describe, expect, it } from "vitest";
import { getTimeZone, getTimeZones, normalizeTimeZone } from "../src/timezones.js";

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
});
