import { describe, expect, it } from "vitest";
import { parseTicketAddressComponents } from "../src/resolve.js";

describe("parseTicketAddressComponents", () => {
  it("returns null for non-objects and empty component bags", () => {
    expect(parseTicketAddressComponents(null)).toBeNull();
    expect(parseTicketAddressComponents("x")).toBeNull();
    expect(parseTicketAddressComponents([])).toBeNull();
    expect(
      parseTicketAddressComponents({
        object_name: "  ",
        street: null,
        postcode: 12,
        city: "",
        region: undefined,
        country: false,
      }),
    ).toBeNull();
  });

  it("reads trimmed string fields and ignores non-strings", () => {
    expect(
      parseTicketAddressComponents({
        object_name: "  Hall  ",
        street: "1 Main St",
        postcode: "00-001",
        city: "Warsaw",
        region: null,
        country: "PL",
        extra: "ignored",
      }),
    ).toEqual({
      object_name: "Hall",
      street: "1 Main St",
      postcode: "00-001",
      city: "Warsaw",
      region: null,
      country: "PL",
    });
  });
});
