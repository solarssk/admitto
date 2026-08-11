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
  });
});
