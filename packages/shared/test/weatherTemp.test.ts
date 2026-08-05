import { describe, expect, it } from "vitest";
import {
  celsiusToFahrenheit,
  formatTempChip,
  formatTempDual,
  formatTempForUnit,
  formatTempRangeDual,
  formatTempRangeForUnit,
  tempUnitFromTimeZone,
} from "../src/weatherTemp.js";

describe("tempUnitFromTimeZone", () => {
  it("uses Celsius for Europe and unknown / empty zones", () => {
    expect(tempUnitFromTimeZone("Europe/Warsaw")).toBe("C");
    expect(tempUnitFromTimeZone("Europe/London")).toBe("C");
    expect(tempUnitFromTimeZone("Asia/Tokyo")).toBe("C");
    expect(tempUnitFromTimeZone("UTC")).toBe("C");
    expect(tempUnitFromTimeZone("")).toBe("C");
    expect(tempUnitFromTimeZone(null)).toBe("C");
  });

  it("uses Fahrenheit for Americas-style zones", () => {
    expect(tempUnitFromTimeZone("America/New_York")).toBe("F");
    expect(tempUnitFromTimeZone("America/Los_Angeles")).toBe("F");
    expect(tempUnitFromTimeZone("America/Toronto")).toBe("F");
    expect(tempUnitFromTimeZone("US/Eastern")).toBe("F");
    expect(tempUnitFromTimeZone("Pacific/Honolulu")).toBe("F");
  });
});

describe("temperature formatters", () => {
  it("converts and rounds for display", () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(18)).toBe(64.4);
    expect(formatTempForUnit(18, "C")).toBe("18°C");
    expect(formatTempForUnit(18, "F")).toBe("64°F");
    expect(formatTempChip(18, "C")).toBe("18°");
    expect(formatTempChip(18, "F")).toBe("64°");
  });

  it("formats ranges for cards and dual ticket copy", () => {
    expect(formatTempRangeForUnit(12, 18, "C")).toBe("12° to 18°C");
    expect(formatTempRangeForUnit(12, 18, "F")).toBe("54° to 64°F");
    expect(formatTempRangeForUnit(null, 18, "C")).toBe("18°C");
    expect(formatTempDual(18)).toBe("18°C (64°F)");
    expect(formatTempRangeDual(12, 18)).toBe("12-18°C (54-64°F)");
  });
});
