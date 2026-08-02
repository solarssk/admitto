import { describe, expect, it } from "vitest";
import {
  formatCompactAddress,
  formatDirectionsAddress,
  formatStreetLine,
  formatVenueName,
} from "../src/formatAddress.js";

describe("formatStreetLine", () => {
  it("joins street and housenumber in European order", () => {
    expect(formatStreetLine({ street: "Marywilska", housenumber: "62" })).toBe("Marywilska 62");
  });

  it("returns whichever side is present alone", () => {
    expect(formatStreetLine({ street: "Marywilska" })).toBe("Marywilska");
    expect(formatStreetLine({ housenumber: "62" })).toBe("62");
  });
});

describe("formatCompactAddress", () => {
  it("formats a named POI as Country, City - Name", () => {
    expect(
      formatCompactAddress({
        name: "Złote Tarasy",
        street: "Złota",
        housenumber: "59",
        city: "Warszawa",
        country: "Polska",
        label: "Złote Tarasy, 59, Złota, Śródmieście, Warszawa, województwo mazowieckie, 00-120, Polska",
      }),
    ).toBe("Polska, Warszawa - Złote Tarasy");
  });

  it("formats a bare street address as Country, City - Street Number", () => {
    expect(
      formatCompactAddress({
        street: "Marywilska",
        housenumber: "62",
        city: "Warszawa",
        country: "Polska",
        label: "62, Marywilska, Żerań, Białołęka, Warszawa, województwo mazowieckie, 03-042, Polska",
      }),
    ).toBe("Polska, Warszawa - Marywilska 62");
  });

  it("falls back to the first two label segments when structured fields are missing", () => {
    expect(
      formatCompactAddress({
        label: "62, Marywilska, Żerań Wschodni, Żerań, Białołęka, Warszawa, Polska",
      }),
    ).toBe("62, Marywilska");
  });

  it.each([
    ["place and country", { name: "Venue", country: "Poland" }, "Poland - Venue"],
    ["place and city", { name: "Venue", city: "Warsaw" }, "Warsaw - Venue"],
    ["place alone", { name: "Venue" }, "Venue"],
    ["country and city without a place", { country: "Poland", city: "Warsaw" }, "Poland, Warsaw"],
    ["country alone", { country: "Poland" }, "Poland"],
    ["city alone", { city: "Warsaw" }, "Warsaw"],
  ])("formats %s without relying on a label", (_case, parts, expected) => {
    expect(formatCompactAddress(parts)).toBe(expected);
  });

  it("keeps a short label intact when structured fields are missing", () => {
    expect(formatCompactAddress({ label: "Warsaw, Poland" })).toBe("Warsaw, Poland");
  });

  it("returns an empty string when nothing useful is present", () => {
    expect(formatCompactAddress({})).toBe("");
  });
});

describe("formatDirectionsAddress", () => {
  it("prefers street + locality over the POI name", () => {
    expect(
      formatDirectionsAddress({
        name: "Sheraton Grand Bangalore Hotel at Brigade Gateway",
        street: "Dr. Rajkumar Road",
        housenumber: "26/1",
        postcode: "560055",
        city: "Bengaluru",
        country: "India",
      }),
    ).toBe("Dr. Rajkumar Road 26/1, 560055 Bengaluru, India");
  });

  it("falls back to compact address when there is no street line", () => {
    expect(
      formatDirectionsAddress({
        name: "Convention Center",
        city: "Warsaw",
        country: "Poland",
      }),
    ).toBe("Poland, Warsaw - Convention Center");
  });

  it("covers shorter street-only locality combinations and label fallback", () => {
    expect(
      formatDirectionsAddress({
        street: "Main St",
        housenumber: "1",
        postcode: "00-001",
        city: "Warsaw",
      }),
    ).toBe("Main St 1, 00-001 Warsaw");
    expect(
      formatDirectionsAddress({
        street: "Main St",
        housenumber: "1",
        country: "Poland",
      }),
    ).toBe("Main St 1, Poland");
    expect(formatDirectionsAddress({ street: "Main St", housenumber: "1" })).toBe("Main St 1");
    expect(formatDirectionsAddress({ label: "Only a long hierarchy label, district, country" })).toBe(
      "Only a long hierarchy label, district",
    );
    expect(formatDirectionsAddress({})).toBe("");
  });
});

describe("formatVenueName", () => {
  it("prefers the POI name", () => {
    expect(formatVenueName({ name: "Złote Tarasy", street: "Złota", housenumber: "59" })).toBe(
      "Złote Tarasy",
    );
  });

  it("uses street+number when there is no POI name", () => {
    expect(formatVenueName({ street: "Marywilska", housenumber: "62", city: "Warszawa" })).toBe(
      "Marywilska 62",
    );
  });

  it("falls back to the compact address when no name or street is available", () => {
    expect(formatVenueName({ city: "Warsaw", country: "Poland" })).toBe("Poland, Warsaw");
  });
});
