import { describe, expect, it } from "vitest";
import {
  EMPTY_ADDRESS_COMPONENTS,
  addressComponentsFromParts,
  isAddressComponentsEmpty,
  normalizeAddressComponents,
  parseStoredAddressComponents,
} from "../src/addressComponents.js";

describe("addressComponentsFromParts", () => {
  it("maps Nominatim parts onto the grid fields", () => {
    expect(
      addressComponentsFromParts({
        name: "Stadion Narodowy",
        street: "Sokola",
        housenumber: "1",
        postcode: "03-724",
        city: "Warsaw",
        state: "Masovian Voivodeship",
        country: "Poland",
      }),
    ).toEqual({
      object_name: "Stadion Narodowy",
      street: "Sokola 1",
      postcode: "03-724",
      city: "Warsaw",
      region: "Masovian Voivodeship",
      country: "Poland",
    });
  });
});

describe("normalizeAddressComponents", () => {
  it("passes null through as clear", () => {
    expect(normalizeAddressComponents(null)).toBeNull();
  });

  it("trims and nulls empty strings", () => {
    expect(
      normalizeAddressComponents({
        object_name: "  Arena  ",
        street: "  ",
        postcode: null,
        city: "Warsaw",
        region: undefined,
        country: "Poland",
      }),
    ).toEqual({
      object_name: "Arena",
      street: null,
      postcode: null,
      city: "Warsaw",
      region: null,
      country: "Poland",
    });
  });

  it("rejects non-objects", () => {
    expect(() => normalizeAddressComponents("nope")).toThrow(/object or null/);
  });
});

describe("parseStoredAddressComponents / isAddressComponentsEmpty", () => {
  it("treats empty components as empty", () => {
    expect(isAddressComponentsEmpty(EMPTY_ADDRESS_COMPONENTS)).toBe(true);
    expect(parseStoredAddressComponents(EMPTY_ADDRESS_COMPONENTS)).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    expect(parseStoredAddressComponents({ object_name: 12 })).toBeNull();
  });
});
