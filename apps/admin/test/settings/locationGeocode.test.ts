import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressComponentsDto, GeocodingResultDto } from "../../src/api/types.js";

vi.mock("../../src/api/client.js", () => ({
  reverseGeocoding: vi.fn(),
}));

import { reverseGeocoding } from "../../src/api/client.js";
import { componentsFromResult, enrichComponentsFromReverse } from "../../src/settings/locationGeocode.js";

const mockReverse = vi.mocked(reverseGeocoding);

const EMPTY: AddressComponentsDto = {
  object_name: null,
  street: null,
  postcode: null,
  city: null,
  region: null,
  country: null,
};

function result(overrides: Partial<GeocodingResultDto> = {}): GeocodingResultDto {
  return {
    name: "Venue",
    formatted_address: "Original address",
    latitude: 50.0614,
    longitude: 19.9366,
    provider: "nominatim",
    ...overrides,
  };
}

beforeEach(() => {
  mockReverse.mockReset();
});

describe("componentsFromResult", () => {
  it("uses non-empty provider components unchanged", () => {
    const components = { ...EMPTY, city: "Kraków" };
    expect(componentsFromResult(result({ components }))).toBe(components);
  });

  it("uses the venue name when geocoding does not include components", () => {
    expect(componentsFromResult(result())).toEqual({ ...EMPTY, object_name: "Venue" });
  });

  it("falls back to the formatted address for an address-only result", () => {
    expect(componentsFromResult(result({ name: undefined, formatted_address: "1 Main Street" }))).toEqual({
      ...EMPTY,
      object_name: "1 Main Street",
    });
  });
});

describe("enrichComponentsFromReverse", () => {
  it("reverse-geocodes sparse components and merges a fuller address", async () => {
    const base = { ...EMPTY, object_name: "Venue" };
    const reverse = result({
      name: "Reverse venue",
      formatted_address: "1 Main Street, Kraków",
      components: { ...EMPTY, street: "1 Main Street", city: "Kraków", country: "Poland" },
    });
    mockReverse.mockResolvedValue({ result: reverse, contact_configured: false });
    const onContactConfigured = vi.fn();

    await expect(enrichComponentsFromReverse(result(), base, onContactConfigured)).resolves.toEqual({
      components: {
        object_name: "Venue",
        street: "1 Main Street",
        postcode: null,
        city: "Kraków",
        region: null,
        country: "Poland",
      },
      formatted_address: "1 Main Street, Kraków",
    });
    expect(mockReverse).toHaveBeenCalledWith(50.0614, 19.9366);
    expect(onContactConfigured).toHaveBeenCalledWith(false);
  });

  it("does not reverse-geocode a non-sparse address", async () => {
    const base = { ...EMPTY, street: "1 Main Street", city: "Kraków", country: "Poland" };
    await expect(enrichComponentsFromReverse(result(), base)).resolves.toEqual({
      components: base,
      formatted_address: "Original address",
    });
    expect(mockReverse).not.toHaveBeenCalled();
  });

  it("keeps sparse components when reverse geocoding has no result", async () => {
    const base = { ...EMPTY, object_name: "Venue" };
    mockReverse.mockResolvedValue({ result: null, contact_configured: true });

    await expect(enrichComponentsFromReverse(result(), base)).resolves.toEqual({
      components: base,
      formatted_address: "Original address",
    });
  });

  it("keeps sparse components when reverse geocoding fails", async () => {
    const base = { ...EMPTY, object_name: "Venue" };
    mockReverse.mockRejectedValue(new Error("unavailable"));

    await expect(enrichComponentsFromReverse(result(), base)).resolves.toEqual({
      components: base,
      formatted_address: "Original address",
    });
  });
});
