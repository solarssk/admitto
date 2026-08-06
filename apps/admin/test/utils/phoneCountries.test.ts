import { describe, expect, it } from "vitest";
import { findPhoneCountryByDialCode, PHONE_COUNTRIES } from "../../src/utils/phoneCountries.js";

describe("PHONE_COUNTRIES", () => {
  it("covers well over a hand-picked subset of countries", () => {
    expect(PHONE_COUNTRIES.length).toBeGreaterThan(200);
  });

  it("sorts by name", () => {
    const names = PHONE_COUNTRIES.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("gives every country a dial code and a flag", () => {
    for (const country of PHONE_COUNTRIES) {
      expect(country.dialCode).toMatch(/^\+\d+$/);
      expect(country.flag.length).toBeGreaterThan(0);
    }
  });

  it("includes Poland with its correct dial code and flag", () => {
    const poland = PHONE_COUNTRIES.find((c) => c.name === "Poland");
    expect(poland?.dialCode).toBe("+48");
    expect(poland?.flag).toBe("🇵🇱");
  });
});

describe("findPhoneCountryByDialCode", () => {
  it("resolves a known dial code", () => {
    expect(findPhoneCountryByDialCode("+48")?.name).toBe("Poland");
  });

  it("returns undefined for a dial code matching nobody", () => {
    expect(findPhoneCountryByDialCode("+999999")).toBeUndefined();
  });
});
