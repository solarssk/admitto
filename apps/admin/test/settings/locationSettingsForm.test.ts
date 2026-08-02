import { describe, expect, it } from "vitest";
import type { EventLocationDto } from "../../src/api/types.js";
import {
  buildEventLocationPatchBody,
  draftFromLocation,
  geocodingProviderLabel,
  isLocationDirty,
  type LocationDraft,
} from "../../src/settings/locationSettingsForm.js";

const EMPTY_LOCATION: EventLocationDto = {
  venue_name: null,
  formatted_address: null,
  latitude: null,
  longitude: null,
  map_zoom: 15,
  directions_text: null,
  accessibility_text: null,
  geocoding_provider: null,
  geocoded_at: null,
  address_components: null,
};

const FULL_LOCATION: EventLocationDto = {
  venue_name: "Springfield Hall",
  formatted_address: "1 Main St, Springfield",
  latitude: 51.5074,
  longitude: -0.1278,
  map_zoom: 16,
  directions_text: "Enter via the north door.",
  accessibility_text: "Step-free access at the north door.",
  geocoding_provider: "nominatim",
  geocoded_at: "2025-01-01T00:00:00.000Z",
  address_components: {
    object_name: "Springfield Hall",
    street: "1 Main St",
    postcode: null,
    city: "Springfield",
    region: null,
    country: null,
  },
};

describe("draftFromLocation", () => {
  it("converts null text fields to empty strings", () => {
    expect(draftFromLocation(EMPTY_LOCATION)).toEqual({
      venue_name: "",
      formatted_address: "",
      latitude: null,
      longitude: null,
      map_zoom: 15,
      directions_text: "",
      accessibility_text: "",
      address_components: {
        object_name: null,
        street: null,
        postcode: null,
        city: null,
        region: null,
        country: null,
      },
    });
  });

  it("preserves populated fields", () => {
    const draft = draftFromLocation(FULL_LOCATION);
    expect(draft.venue_name).toBe("Springfield Hall");
    expect(draft.formatted_address).toBe("1 Main St, Springfield");
    expect(draft.latitude).toBe(51.5074);
    expect(draft.longitude).toBe(-0.1278);
    expect(draft.map_zoom).toBe(16);
    expect(draft.directions_text).toBe("Enter via the north door.");
    expect(draft.accessibility_text).toBe("Step-free access at the north door.");
  });
});

describe("isLocationDirty", () => {
  const saved = draftFromLocation(FULL_LOCATION);

  it("is false when the draft matches the saved state", () => {
    expect(isLocationDirty({ ...saved }, saved)).toBe(false);
  });

  it("ignores leading/trailing whitespace-only differences in text fields", () => {
    const draft: LocationDraft = { ...saved, formatted_address: `  ${saved.formatted_address}  ` };
    expect(isLocationDirty(draft, saved)).toBe(false);
  });

  it("is true when the venue name changes", () => {
    const draft: LocationDraft = { ...saved, venue_name: "A different hall" };
    expect(isLocationDirty(draft, saved)).toBe(true);
  });

  it("is true when the address changes", () => {
    const draft: LocationDraft = { ...saved, formatted_address: "Somewhere else" };
    expect(isLocationDirty(draft, saved)).toBe(true);
  });

  it("is true when coordinates change", () => {
    const draft: LocationDraft = { ...saved, latitude: 1, longitude: 2 };
    expect(isLocationDirty(draft, saved)).toBe(true);
  });

  it("is true when map_zoom changes", () => {
    const draft: LocationDraft = { ...saved, map_zoom: saved.map_zoom + 1 };
    expect(isLocationDirty(draft, saved)).toBe(true);
  });

  it("is true when directions or accessibility text changes", () => {
    expect(isLocationDirty({ ...saved, directions_text: "New directions" }, saved)).toBe(true);
    expect(isLocationDirty({ ...saved, accessibility_text: "New notes" }, saved)).toBe(true);
  });
});

describe("buildEventLocationPatchBody", () => {
  const saved = draftFromLocation(FULL_LOCATION);

  it("returns an empty body when nothing changed", () => {
    expect(buildEventLocationPatchBody({ ...saved }, saved, null)).toEqual({});
  });

  it("includes only the changed fields", () => {
    const draft: LocationDraft = { ...saved, directions_text: "Updated directions" };
    expect(buildEventLocationPatchBody(draft, saved, null)).toEqual({
      directions_text: "Updated directions",
    });
  });

  it("clears a text field to null when emptied", () => {
    const draft: LocationDraft = { ...saved, directions_text: "" };
    expect(buildEventLocationPatchBody(draft, saved, null)).toEqual({
      directions_text: null,
    });
  });

  it("clears accessibility text to null when emptied", () => {
    const draft: LocationDraft = { ...saved, accessibility_text: "" };
    expect(buildEventLocationPatchBody(draft, saved, null)).toEqual({
      accessibility_text: null,
    });
  });

  it("trims the address and clears it to null when only whitespace remains", () => {
    const draft: LocationDraft = { ...saved, formatted_address: "   " };
    expect(buildEventLocationPatchBody(draft, saved, null)).toEqual({
      formatted_address: null,
    });
  });

  it("includes the venue name when changed, clears Verified provenance, and nulls an emptied name", () => {
    const draft: LocationDraft = { ...saved, venue_name: "New Hall" };
    expect(buildEventLocationPatchBody(draft, saved, null)).toEqual({
      venue_name: "New Hall",
      geocoding_provider: null,
    });

    const cleared: LocationDraft = { ...saved, venue_name: "   " };
    expect(buildEventLocationPatchBody(cleared, saved, null)).toEqual({
      venue_name: null,
      geocoding_provider: null,
    });
  });

  it("includes geocoding_provider only when coordinates changed and a pending provider is set", () => {
    const draft: LocationDraft = { ...saved, latitude: 10, longitude: 20 };
    expect(buildEventLocationPatchBody(draft, saved, "nominatim")).toEqual({
      latitude: 10,
      longitude: 20,
      geocoding_provider: "nominatim",
    });
  });

  it("omits geocoding_provider for a manual pin move even if coordinates changed", () => {
    const draft: LocationDraft = { ...saved, latitude: 10, longitude: 20 };
    // pendingGeocodingProvider is null: the caller (LocationSettingsPanel) clears it on every
    // manual map click/drag/clear, so a manual move never carries stale search provenance.
    expect(buildEventLocationPatchBody(draft, saved, null)).toEqual({
      latitude: 10,
      longitude: 20,
    });
  });

  it("omits geocoding_provider when coordinates are unchanged, even if a pending provider is set", () => {
    const draft: LocationDraft = { ...saved, directions_text: "Updated directions" };
    // Defensive: this combination shouldn't happen in practice (picking a search result always
    // sets coordinates), but the provider must never leak onto an unrelated text-only save.
    expect(buildEventLocationPatchBody(draft, saved, "nominatim")).toEqual({
      directions_text: "Updated directions",
    });
  });

  it("handles clearing the map location (both coordinates set to null)", () => {
    const draft: LocationDraft = { ...saved, latitude: null, longitude: null };
    expect(buildEventLocationPatchBody(draft, saved, null)).toEqual({
      latitude: null,
      longitude: null,
    });
  });

  it("includes changed address components", () => {
    const draft: LocationDraft = {
      ...saved,
      address_components: { ...saved.address_components, city: "Shelbyville" },
    };
    expect(buildEventLocationPatchBody(draft, saved, null)).toEqual({
      address_components: { ...saved.address_components, city: "Shelbyville" },
    });
  });

  it("sends null when every address component is emptied", () => {
    const draft: LocationDraft = {
      ...saved,
      address_components: {
        object_name: null,
        street: null,
        postcode: null,
        city: null,
        region: null,
        country: null,
      },
    };
    expect(buildEventLocationPatchBody(draft, saved, null)).toEqual({
      address_components: null,
    });
  });

  it("omits address_components when unchanged", () => {
    const draft: LocationDraft = { ...saved, directions_text: "Updated directions" };
    expect(buildEventLocationPatchBody(draft, saved, null)).toEqual({
      directions_text: "Updated directions",
    });
  });
});

describe("geocodingProviderLabel", () => {
  it("maps 'nominatim' to 'Nominatim'", () => {
    expect(geocodingProviderLabel("nominatim")).toBe("Nominatim");
  });

  it("capitalizes an unknown provider code", () => {
    expect(geocodingProviderLabel("mapbox")).toBe("Mapbox");
  });
});
