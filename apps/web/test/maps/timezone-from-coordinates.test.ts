import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("geo-tz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("geo-tz")>();
  return { ...actual, find: vi.fn(actual.find) };
});

import { find as findTimezones } from "geo-tz";
import { timezoneFromCoordinates } from "../../src/maps/timezone-from-coordinates.js";

afterEach(() => {
  vi.mocked(findTimezones).mockClear();
});

describe("timezoneFromCoordinates", () => {
  it("returns Europe/Warsaw for central Warsaw", () => {
    expect(timezoneFromCoordinates(52.2297, 21.0122)).toBe("Europe/Warsaw");
  });

  it("returns an India zone for a pin in India", () => {
    // New Delhi — geo-tz may return Asia/Kolkata (or a nearby India zone).
    const tz = timezoneFromCoordinates(28.6139, 77.209);
    expect(tz).toBe("Asia/Kolkata");
  });

  it("normalizes a legacy zone returned by the coordinate lookup", () => {
    vi.mocked(findTimezones).mockReturnValueOnce(["Asia/Calcutta"]);
    expect(timezoneFromCoordinates(28.6139, 77.209)).toBe("Asia/Kolkata");
  });

  it("preserves an unrecognized zone returned by the coordinate lookup", () => {
    vi.mocked(findTimezones).mockReturnValueOnce(["Legacy/Removed"]);
    expect(timezoneFromCoordinates(28.6139, 77.209)).toBe("Legacy/Removed");
  });

  it("returns an Etc zone over open ocean rather than throwing", () => {
    expect(timezoneFromCoordinates(0, -30)).toMatch(/^Etc\//);
  });

  it("returns null when geo-tz finds no matching zone", () => {
    vi.mocked(findTimezones).mockReturnValueOnce([]);
    expect(timezoneFromCoordinates(52.2297, 21.0122)).toBeNull();
  });

  it("returns null when geo-tz throws", () => {
    vi.mocked(findTimezones).mockImplementationOnce(() => {
      throw new Error("timezone data unavailable");
    });
    expect(timezoneFromCoordinates(52.2297, 21.0122)).toBeNull();
  });
});
