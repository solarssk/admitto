import { describe, expect, it } from "vitest";
import { timezoneFromCoordinates } from "../../src/maps/timezone-from-coordinates.js";

describe("timezoneFromCoordinates", () => {
  it("returns Europe/Warsaw for central Warsaw", () => {
    expect(timezoneFromCoordinates(52.2297, 21.0122)).toBe("Europe/Warsaw");
  });

  it("returns an India zone for a pin in India", () => {
    // New Delhi — geo-tz may return Asia/Kolkata (or a nearby India zone).
    const tz = timezoneFromCoordinates(28.6139, 77.209);
    expect(tz).toBe("Asia/Kolkata");
  });

  it("returns an Etc zone over open ocean rather than throwing", () => {
    expect(timezoneFromCoordinates(0, -30)).toMatch(/^Etc\//);
  });
});
