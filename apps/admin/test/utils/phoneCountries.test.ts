import { describe, expect, it } from "vitest";
import {
  composePhoneE164,
  findPhoneCountryByDialCode,
  PHONE_COUNTRIES,
  splitPhoneForPicker,
} from "../../src/utils/phoneCountries.js";

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

describe("contact phone picker helpers", () => {
  it("splits an existing E.164 value into a country code and national number", () => {
    expect(splitPhoneForPicker("+48500100200")).toEqual({
      dialCode: "+48",
      nationalNumber: "500100200",
    });
  });

  it("keeps an unrecognized legacy phone value editable", () => {
    expect(splitPhoneForPicker("office extension 42")).toEqual({
      dialCode: "",
      nationalNumber: "office extension 42",
    });
  });

  it("composes a picker value into one E.164 phone string", () => {
    expect(composePhoneE164("+48", "500 100 200")).toBe("+48500100200");
  });
});
