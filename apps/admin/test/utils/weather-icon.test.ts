import { describe, expect, it } from "vitest";
import { weatherConditionLabel, weatherIconClass } from "../../src/utils/weather-icon.js";

describe("weather-icon", () => {
  it("maps known WMO codes to labels and icons", () => {
    expect(weatherConditionLabel(0)).toBe("Clear");
    expect(weatherIconClass(0)).toBe("ti ti-sun");
    expect(weatherConditionLabel(61)).toBe("Rain");
    expect(weatherIconClass(95)).toBe("ti ti-cloud-storm");
  });

  it("falls back for null and unknown codes", () => {
    expect(weatherConditionLabel(null)).toBe("Weather");
    expect(weatherIconClass(undefined)).toBe("ti ti-cloud");
    expect(weatherConditionLabel(999)).toBe("Weather");
    expect(weatherIconClass(999)).toBe("ti ti-cloud");
  });
});
