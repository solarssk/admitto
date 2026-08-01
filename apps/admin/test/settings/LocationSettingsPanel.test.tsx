// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationSettingsPanel } from "../../src/settings/LocationSettingsPanel.js";
import { renderWithToast } from "../test-utils.js";
import type { EventLocationDto, GeocodingResultDto, MapTileConfigDto } from "../../src/api/types.js";

// jsdom doesn't implement ResizeObserver - the real MapPicker rendered inside this panel uses
// it to fix Leaflet's size once its tab panel becomes visible (see MapPicker.tsx).
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

let mockAssignments: Array<{ role: string; scope_type: string; scope_id: string | null }> = [
  { role: "superadmin", scope_type: "instance", scope_id: null },
];

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: mockAssignments }),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchEventLocation: vi.fn(),
    saveEventLocation: vi.fn(),
    searchGeocoding: vi.fn(),
    reverseGeocoding: vi.fn(),
    fetchMapTileConfig: vi.fn(),
    fetchTimezoneForCoordinates: vi.fn().mockResolvedValue({ timezone: "Europe/London" }),
  };
});

import {
  fetchEventLocation,
  fetchMapTileConfig,
  reverseGeocoding,
  saveEventLocation,
  searchGeocoding,
} from "../../src/api/client.js";

const mockFetchLocation = vi.mocked(fetchEventLocation);
const mockSaveLocation = vi.mocked(saveEventLocation);
const mockSearch = vi.mocked(searchGeocoding);
const mockReverse = vi.mocked(reverseGeocoding);
const mockFetchTiles = vi.mocked(fetchMapTileConfig);

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

const SAVED_LOCATION: EventLocationDto = {
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

const TILE_CONFIG: MapTileConfigDto = {
  enabled: true,
  tile_url: "https://tile.example/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors",
  max_zoom: 19,
  contact_configured: true,
};

function searchResult(overrides: Partial<GeocodingResultDto> = {}): GeocodingResultDto {
  return {
    name: "10 Downing Street",
    formatted_address: "10 Downing Street, London",
    latitude: 51.5034,
    longitude: -0.1276,
    provider: "nominatim",
    ...overrides,
  };
}

function renderPanel(
  props: Partial<{
    eventId: string;
    isArchived: boolean;
    eventTimezone: string;
    onDirtyChange: (d: boolean) => void;
    onSavingChange: (s: boolean) => void;
    onLocationSaved: () => Promise<void> | void;
  }> = {},
) {
  return renderWithToast(
    <MemoryRouter>
      <LocationSettingsPanel
        eventId="evt-1"
        isArchived={false}
        eventTimezone="Europe/Warsaw"
        {...props}
      />
    </MemoryRouter>,
  );
}

/** Renders with a real route table so "Open organisation settings" navigation is observable. */
function renderPanelWithRoutes() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/settings"]}>
      <Routes>
        <Route
          path="/admin/events/evt-1/settings"
          element={
            <LocationSettingsPanel eventId="evt-1" isArchived={false} eventTimezone="Europe/Warsaw" />
          }
        />
        <Route path="/admin/settings" element={<div>organisation-settings-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockAssignments = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
  mockFetchLocation.mockReset();
  mockSaveLocation.mockReset();
  mockSearch.mockReset();
  mockReverse.mockReset();
  // Default to "no matches" so a debounced search triggered incidentally by an unrelated test
  // (e.g. typing a new venue name) doesn't reject and log noise - tests that care about search
  // results override this explicitly.
  mockSearch.mockResolvedValue({ results: [], contact_configured: true });
  mockReverse.mockResolvedValue({ result: null, contact_configured: true });
  mockFetchTiles.mockReset();
  mockFetchTiles.mockResolvedValue(TILE_CONFIG);
});

afterEach(() => {
  cleanup();
});

describe("LocationSettingsPanel — loading", () => {
  it("shows the saved venue name once loaded", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    renderPanel();

    expect(await screen.findByDisplayValue("Springfield Hall")).toBeTruthy();
  });

  it("shows reserved coordinate placeholder when no coordinates are set yet", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    renderPanel();

    expect(await screen.findByLabelText("Address details")).toBeTruthy();
    expect(await screen.findByText("Find on map")).toBeTruthy();
    await waitFor(() => {
      expect(document.querySelector(".location-map-footer__coords")?.textContent).toContain("-");
    });
  });

  it("shows a retry link on load failure", async () => {
    mockFetchLocation.mockRejectedValue(new Error("network down"));
    renderPanel();

    expect(await screen.findByText("Retry")).toBeTruthy();
  });
});

describe("LocationSettingsPanel — dirty state and save", () => {
  it("reports dirty after a venue name edit and clears it after a successful save", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockSaveLocation.mockResolvedValue({ ...SAVED_LOCATION, venue_name: "New Hall" });
    const onDirtyChange = vi.fn();
    renderPanel({ onDirtyChange });

    const input = await screen.findByDisplayValue("Springfield Hall");
    fireEvent.change(input, { target: { value: "New Hall" } });

    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockSaveLocation).toHaveBeenCalledWith("evt-1", { venue_name: "New Hall" }),
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(await screen.findByText("Location saved.")).toBeTruthy();
  });

  it("resets the draft back to the saved values", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    renderPanel();

    const input = await screen.findByDisplayValue("Springfield Hall");
    fireEvent.change(input, { target: { value: "Something else" } });
    expect(await screen.findByText("Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(await screen.findByDisplayValue("Springfield Hall")).toBeTruthy();
    expect(screen.queryByText("Unsaved changes")).toBeFalsy();
  });

  it("shows a toast and keeps the draft on save failure", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockSaveLocation.mockRejectedValue(new Error("boom"));
    renderPanel();

    const input = await screen.findByDisplayValue("Springfield Hall");
    fireEvent.change(input, { target: { value: "New Hall" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Failed to save location.")).toBeTruthy();
    expect(screen.getByDisplayValue("New Hall")).toBeTruthy();
  });
});

describe("LocationSettingsPanel — venue search", () => {
  it("searches and lists suggestions while typing, debounced", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockSearch.mockResolvedValue({ results: [searchResult()], contact_configured: true });
    renderPanel();

    const input = await screen.findByLabelText("Venue name or address");
    fireEvent.change(input, { target: { value: "Downing Street" } });

    await expect(screen.findByText("10 Downing Street")).resolves.toBeTruthy();
    expect(mockSearch).toHaveBeenCalledWith("Downing Street");
  });

  it("keeps the typed text as free-form venue name when no suggestions match", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockSearch.mockResolvedValue({ results: [], contact_configured: true });
    renderPanel();

    const input = await screen.findByLabelText("Venue name or address");
    fireEvent.change(input, { target: { value: "Nowhere Hall" } });

    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith("Nowhere Hall"));
    expect(screen.getByDisplayValue("Nowhere Hall")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Venue suggestions" })).toBeFalsy();
  });

  it("silently ignores a failed suggestion search - typing still works", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockSearch.mockRejectedValue(new Error("rate limited"));
    renderPanel();

    const input = await screen.findByLabelText("Venue name or address");
    fireEvent.change(input, { target: { value: "Downing Street" } });

    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith("Downing Street"));
    expect(screen.getByDisplayValue("Downing Street")).toBeTruthy();
    expect(screen.queryByText(/failed/i)).toBeFalsy();
  });

  it("applies a selected result's name, address, and coordinates, and saves with its geocoding_provider", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockSearch.mockResolvedValue({ results: [searchResult()], contact_configured: true });
    mockSaveLocation.mockResolvedValue({
      ...EMPTY_LOCATION,
      venue_name: "10 Downing Street",
      formatted_address: "10 Downing Street, London",
      latitude: 51.5034,
      longitude: -0.1276,
      geocoding_provider: "nominatim",
    });
    renderPanel();

    const input = await screen.findByLabelText("Venue name or address");
    fireEvent.change(input, { target: { value: "Downing Street" } });

    fireEvent.click(await screen.findByRole("button", { name: /10 Downing Street/ }));

    expect(await screen.findByDisplayValue("10 Downing Street")).toBeTruthy();
    expect(await screen.findByText("Verified on OpenStreetMap")).toBeTruthy();
    expect(await screen.findByText("51.50340, -0.12760")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockSaveLocation).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({
          venue_name: "10 Downing Street",
          formatted_address: "10 Downing Street, London",
          latitude: 51.5034,
          longitude: -0.1276,
          geocoding_provider: "nominatim",
          address_components: {
            object_name: "10 Downing Street",
            street: null,
            postcode: null,
            city: null,
            region: null,
            country: null,
          },
        }),
      ),
    );
  });

  it("Find on map shows a no-match notice when OSM returns nothing", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockSearch.mockResolvedValue({ results: [], contact_configured: true });
    renderPanel();

    const input = await screen.findByLabelText("Venue name or address");
    fireEvent.change(input, { target: { value: "Nowhere Hall" } });
    fireEvent.click(screen.getByRole("button", { name: "Find on map" }));

    expect(await screen.findByText(/No match found on OpenStreetMap/)).toBeTruthy();
  });

  it("warns about missing Support contact on load, before any search", async () => {
    mockAssignments = [{ role: "admin", scope_type: "organization", scope_id: "org-1" }];
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockFetchTiles.mockResolvedValue({ ...TILE_CONFIG, contact_configured: false });
    renderPanelWithRoutes();

    expect(await screen.findByText(/No Support contact is configured/)).toBeTruthy();
    expect(screen.getByText(/Ask a superadmin to set one in Organisation settings/)).toBeTruthy();
    expect(screen.queryByText("Open organisation settings")).toBeNull();
  });

  it("offers Organisation settings to a superadmin when Support contact is missing", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockFetchTiles.mockResolvedValue({ ...TILE_CONFIG, contact_configured: false });
    renderPanelWithRoutes();

    expect(await screen.findByText(/Set one in Organisation settings/)).toBeTruthy();
    fireEvent.click(screen.getByText("Open organisation settings"));
    expect(await screen.findByText("organisation-settings-page")).toBeTruthy();
  });

  it("also updates the Support-contact notice from a search response", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockSearch.mockResolvedValue({ results: [searchResult()], contact_configured: false });
    renderPanel();

    // Start configured (default TILE_CONFIG), then a search flips it off.
    await screen.findByLabelText("Venue name or address");
    expect(screen.queryByText(/No Support contact is configured/)).toBeFalsy();

    fireEvent.change(screen.getByLabelText("Venue name or address"), {
      target: { value: "Downing Street" },
    });
    expect(await screen.findByText(/No Support contact is configured/)).toBeTruthy();
  });
});

describe("LocationSettingsPanel — clearing and map availability", () => {
  it("clears coordinates and address grid via Clear map, but keeps the venue name", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    renderPanel();

    await screen.findByDisplayValue("Springfield Hall");
    fireEvent.click(screen.getByRole("button", { name: "Clear map" }));

    expect(screen.getByDisplayValue("Springfield Hall")).toBeTruthy();
    await waitFor(() => {
      expect(document.querySelector(".location-map-footer__coords")?.textContent).toContain("-");
    });
    expect(screen.queryByText("Verified on OpenStreetMap")).toBeFalsy();
    expect(await screen.findByText("Unsaved changes")).toBeTruthy();
  });

  it("shows a notice instead of the map when tiles are disabled", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockFetchTiles.mockResolvedValue({ ...TILE_CONFIG, enabled: false });
    renderPanel();

    expect(await screen.findByText(/Map display is disabled for this instance/)).toBeTruthy();
  });
});

describe("LocationSettingsPanel — archived event", () => {
  it("hides the save footer and the clear-map button for an archived event", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    renderPanel({ isArchived: true });

    await screen.findByDisplayValue("Springfield Hall");
    expect(screen.queryByRole("button", { name: "Save" })).toBeFalsy();
    expect(screen.queryByRole("button", { name: "Clear map" })).toBeFalsy();
    expect(screen.getByText(/location settings cannot be changed/)).toBeTruthy();
  });
});
