import { describe, expect, it } from "vitest";
import {
  EMPTY_ADDRESS_COMPONENTS,
  addressComponentsFromNominatimLabel,
  addressComponentsFromParts,
  isAddressComponentsEmpty,
  isAddressComponentsSparse,
  mergeAddressComponents,
  normalizeAddressComponents,
  parseStoredAddressComponents,
  preferNumberedStreet,
  streetLineLooksNumbered,
  formatDirectionsAddressFromComponents,
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

describe("addressComponentsFromNominatimLabel", () => {
  it("parses a Polish amenity label into street/city/region/country", () => {
    expect(
      addressComponentsFromNominatimLabel(
        "Złote Tarasy, 59, Złota, Śródmieście, Warszawa, województwo mazowieckie, Polska",
        "Złote Tarasy",
      ),
    ).toEqual({
      object_name: "Złote Tarasy",
      street: "Złota 59",
      postcode: null,
      city: "Warszawa",
      region: "województwo mazowieckie",
      country: "Polska",
    });
  });

  it("extracts the postcode when the label carries one", () => {
    expect(
      addressComponentsFromNominatimLabel(
        "Złote Tarasy, 59, Złota, Śródmieście, Warszawa, województwo mazowieckie, 00-120, Polska",
        "Złote Tarasy",
      ),
    ).toEqual({
      object_name: "Złote Tarasy",
      street: "Złota 59",
      postcode: "00-120",
      city: "Warszawa",
      region: "województwo mazowieckie",
      country: "Polska",
    });
  });

  it("uses the first leftover segment as street when no housenumber is present", () => {
    expect(
      addressComponentsFromNominatimLabel(
        "Some Venue, Złota, Śródmieście, Warszawa, Polska",
        "Some Venue",
      ),
    ).toEqual({
      object_name: "Some Venue",
      street: "Złota",
      postcode: null,
      city: "Warszawa",
      region: null,
      country: "Polska",
    });
  });

  it("returns empty components for a blank label", () => {
    expect(addressComponentsFromNominatimLabel("   ", "Only Name")).toEqual({
      ...EMPTY_ADDRESS_COMPONENTS,
      object_name: "Only Name",
    });
  });

  it("parses housenumber glued onto the street segment", () => {
    expect(
      addressComponentsFromNominatimLabel(
        "PGE Narodowy, Wybrzeże Szczecińskie 1, Warszawa, województwo mazowieckie, Polska",
        "PGE Narodowy",
      ),
    ).toEqual({
      object_name: "PGE Narodowy",
      street: "Wybrzeże Szczecińskie 1",
      postcode: null,
      city: "Warszawa",
      region: "województwo mazowieckie",
      country: "Polska",
    });
  });

  it("parses housenumber not in the first leftover segment", () => {
    expect(
      addressComponentsFromNominatimLabel("Venue, Złota, 12, Warszawa, Polska", "Venue"),
    ).toEqual({
      object_name: "Venue",
      street: "Złota 12",
      postcode: null,
      city: "Warszawa",
      region: null,
      country: "Polska",
    });
  });

  it("returns null street when leftovers are only a house number", () => {
    expect(
      addressComponentsFromNominatimLabel("Venue, 12, Warszawa, Polska", "Venue"),
    ).toEqual({
      object_name: "Venue",
      street: null,
      postcode: null,
      city: "Warszawa",
      region: null,
      country: "Polska",
    });
  });

  it("returns null street when every leftover segment was consumed as country/city", () => {
    expect(addressComponentsFromNominatimLabel("Venue, Polska", "Venue")).toEqual({
      object_name: "Venue",
      street: null,
      postcode: null,
      city: null,
      region: null,
      country: "Polska",
    });
  });

  it("keeps leading segments when the POI name is not the first label token", () => {
    expect(
      addressComponentsFromNominatimLabel("59, Złota, Warszawa, Polska", "Other Name"),
    ).toEqual({
      object_name: "Other Name",
      street: "Złota 59",
      postcode: null,
      city: "Warszawa",
      region: null,
      country: "Polska",
    });
  });
});

describe("preferNumberedStreet / streetLineLooksNumbered", () => {
  it("detects a trailing house number on a street line", () => {
    expect(streetLineLooksNumbered("Wybrzeże Szczecińskie 1")).toBe(true);
    expect(streetLineLooksNumbered("12 Main Street")).toBe(true);
    expect(streetLineLooksNumbered("12A")).toBe(true);
    expect(streetLineLooksNumbered("Dr. Rajkumar Road")).toBe(false);
    expect(streetLineLooksNumbered(null)).toBe(false);
    expect(streetLineLooksNumbered("   ")).toBe(false);
  });

  it("overwrites a street-only primary with a numbered fallback", () => {
    expect(
      preferNumberedStreet(
        {
          ...EMPTY_ADDRESS_COMPONENTS,
          object_name: "Stadium",
          street: "Wybrzeże Szczecińskie",
          city: "Warszawa",
          country: "Polska",
        },
        {
          ...EMPTY_ADDRESS_COMPONENTS,
          street: "Wybrzeże Szczecińskie 1",
          city: "Warszawa",
          country: "Polska",
        },
      ).street,
    ).toBe("Wybrzeże Szczecińskie 1");
  });

  it("keeps the primary street when it is already numbered", () => {
    expect(
      preferNumberedStreet(
        {
          ...EMPTY_ADDRESS_COMPONENTS,
          street: "Main 1",
          city: "Warsaw",
        },
        {
          ...EMPTY_ADDRESS_COMPONENTS,
          street: "Other 9",
          city: "Warsaw",
        },
      ).street,
    ).toBe("Main 1");
  });

  it("prefers a fallback that appends a house number to a numeric street name", () => {
    expect(
      preferNumberedStreet(
        {
          ...EMPTY_ADDRESS_COMPONENTS,
          street: "Route 66",
          city: "Springfield",
        },
        {
          ...EMPTY_ADDRESS_COMPONENTS,
          street: "Route 66 100",
          city: "Springfield",
        },
      ).street,
    ).toBe("Route 66 100");
  });

  it("treats null streets as empty when deciding whether a fallback extends the primary", () => {
    expect(
      preferNumberedStreet(
        { ...EMPTY_ADDRESS_COMPONENTS, street: null, city: "Warsaw" },
        { ...EMPTY_ADDRESS_COMPONENTS, street: "Main 1", city: "Warsaw" },
      ).street,
    ).toBe("Main 1");
    expect(
      preferNumberedStreet(
        { ...EMPTY_ADDRESS_COMPONENTS, street: "Main", city: "Warsaw" },
        { ...EMPTY_ADDRESS_COMPONENTS, street: null, city: "Warsaw" },
      ).street,
    ).toBe("Main");
  });
});

describe("isAddressComponentsSparse / mergeAddressComponents", () => {
  it("treats null/empty and name-only grids as sparse", () => {
    expect(isAddressComponentsSparse(null)).toBe(true);
    expect(isAddressComponentsSparse(EMPTY_ADDRESS_COMPONENTS)).toBe(true);
    expect(
      isAddressComponentsSparse({
        ...EMPTY_ADDRESS_COMPONENTS,
        object_name: "POI",
      }),
    ).toBe(true);
    expect(
      isAddressComponentsSparse({
        ...EMPTY_ADDRESS_COMPONENTS,
        object_name: "POI",
        street: "Main St",
      }),
    ).toBe(false);
  });

  it("fills null fields from the fallback without overwriting set values", () => {
    expect(
      mergeAddressComponents(
        {
          object_name: null,
          street: null,
          postcode: null,
          city: null,
          region: null,
          country: null,
        },
        {
          object_name: "Fallback POI",
          street: "Main 1",
          postcode: "00-001",
          city: "Warsaw",
          region: "Mazovia",
          country: "Poland",
        },
      ),
    ).toEqual({
      object_name: "Fallback POI",
      street: "Main 1",
      postcode: "00-001",
      city: "Warsaw",
      region: "Mazovia",
      country: "Poland",
    });
  });
});

describe("normalizeAddressComponents", () => {
  it("passes null through as clear", () => {
    expect(normalizeAddressComponents(null)).toBeNull();
  });

  it("passes undefined through as omitted", () => {
    expect(normalizeAddressComponents(undefined)).toBeUndefined();
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

  it("rejects non-string field values", () => {
    expect(() => normalizeAddressComponents({ city: 12 })).toThrow(/must be a string or null/);
  });

  it("truncates components longer than the max length", () => {
    const long = "x".repeat(250);
    expect(normalizeAddressComponents({ city: long })?.city).toHaveLength(200);
  });
});

describe("parseStoredAddressComponents / isAddressComponentsEmpty", () => {
  it("treats empty components as empty", () => {
    expect(isAddressComponentsEmpty(null)).toBe(true);
    expect(isAddressComponentsEmpty(EMPTY_ADDRESS_COMPONENTS)).toBe(true);
    expect(parseStoredAddressComponents(EMPTY_ADDRESS_COMPONENTS)).toBeNull();
  });

  it("returns null when the stored value is omitted or null", () => {
    expect(parseStoredAddressComponents(undefined)).toBeNull();
    expect(parseStoredAddressComponents(null)).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    expect(parseStoredAddressComponents({ object_name: 12 })).toBeNull();
  });

  it("returns normalized non-empty stored components", () => {
    expect(
      parseStoredAddressComponents({
        object_name: "Hall",
        street: null,
        postcode: null,
        city: "Warsaw",
        region: null,
        country: null,
      }),
    ).toEqual({
      object_name: "Hall",
      street: null,
      postcode: null,
      city: "Warsaw",
      region: null,
      country: null,
    });
  });
});

describe("formatDirectionsAddressFromComponents", () => {
  it("falls back to the long label when the grid is empty", () => {
    expect(formatDirectionsAddressFromComponents(null, "  Hall, City  ")).toBe("Hall, City");
    expect(formatDirectionsAddressFromComponents(EMPTY_ADDRESS_COMPONENTS, null)).toBe("");
  });

  it("formats a structured grid address for attendees", () => {
    expect(
      formatDirectionsAddressFromComponents({
        object_name: "Arena",
        street: "Main 1",
        postcode: "00-001",
        city: "Warsaw",
        region: null,
        country: "Poland",
      }),
    ).toContain("Main 1");
  });
});
