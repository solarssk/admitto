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

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [{ role: "superadmin", scope_type: "instance", scope_id: null }] }),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchEventLocation: vi.fn(),
    saveEventLocation: vi.fn(),
    searchGeocoding: vi.fn(),
    fetchMapTileConfig: vi.fn(),
  };
});

import {
  fetchEventLocation,
  fetchMapTileConfig,
  saveEventLocation,
  searchGeocoding,
} from "../../src/api/client.js";

const mockFetchLocation = vi.mocked(fetchEventLocation);
const mockSaveLocation = vi.mocked(saveEventLocation);
const mockSearch = vi.mocked(searchGeocoding);
const mockFetchTiles = vi.mocked(fetchMapTileConfig);

const EMPTY_LOCATION: EventLocationDto = {
  formatted_address: null,
  latitude: null,
  longitude: null,
  map_zoom: 15,
  directions_text: null,
  accessibility_text: null,
  geocoding_provider: null,
  geocoded_at: null,
};

const SAVED_LOCATION: EventLocationDto = {
  formatted_address: "1 Main St, Springfield",
  latitude: 51.5074,
  longitude: -0.1278,
  map_zoom: 16,
  directions_text: "Enter via the north door.",
  accessibility_text: "Step-free access at the north door.",
  geocoding_provider: "nominatim",
  geocoded_at: "2025-01-01T00:00:00.000Z",
};

const TILE_CONFIG: MapTileConfigDto = {
  enabled: true,
  tile_url: "https://tile.example/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors",
  max_zoom: 19,
};

function searchResult(overrides: Partial<GeocodingResultDto> = {}): GeocodingResultDto {
  return {
    formatted_address: "10 Downing Street, London",
    latitude: 51.5034,
    longitude: -0.1276,
    provider: "nominatim",
    ...overrides,
  };
}

function renderPanel(
  props: Partial<{ eventId: string; isArchived: boolean; onDirtyChange: (d: boolean) => void; onSavingChange: (s: boolean) => void }> = {},
) {
  return renderWithToast(
    <MemoryRouter>
      <LocationSettingsPanel eventId="evt-1" isArchived={false} {...props} />
    </MemoryRouter>,
  );
}

/** Renders with a real route table so "Open instance settings" navigation is observable. */
function renderPanelWithRoutes() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/settings"]}>
      <Routes>
        <Route
          path="/admin/events/evt-1/settings"
          element={<LocationSettingsPanel eventId="evt-1" isArchived={false} />}
        />
        <Route path="/admin/settings" element={<div>instance-settings-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockFetchLocation.mockReset();
  mockSaveLocation.mockReset();
  mockSearch.mockReset();
  mockFetchTiles.mockReset();
  mockFetchTiles.mockResolvedValue(TILE_CONFIG);
});

afterEach(() => {
  cleanup();
});

describe("LocationSettingsPanel — loading", () => {
  it("shows the saved address once loaded", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    renderPanel();

    expect(await screen.findByDisplayValue("1 Main St, Springfield")).toBeTruthy();
  });

  it("shows a placeholder hint when no coordinates are set yet", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    renderPanel();

    expect(await screen.findByText(/No coordinates set yet/)).toBeTruthy();
  });

  it("shows a retry link on load failure", async () => {
    mockFetchLocation.mockRejectedValue(new Error("network down"));
    renderPanel();

    expect(await screen.findByText("Retry")).toBeTruthy();
  });
});

describe("LocationSettingsPanel — dirty state and save", () => {
  it("reports dirty after an address edit and clears it after a successful save", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockSaveLocation.mockResolvedValue({ ...SAVED_LOCATION, formatted_address: "2 Main St, Springfield" });
    const onDirtyChange = vi.fn();
    renderPanel({ onDirtyChange });

    const input = await screen.findByDisplayValue("1 Main St, Springfield");
    fireEvent.change(input, { target: { value: "2 Main St, Springfield" } });

    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockSaveLocation).toHaveBeenCalledWith("evt-1", { formatted_address: "2 Main St, Springfield" }),
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(await screen.findByText("Location saved.")).toBeTruthy();
  });

  it("resets the draft back to the saved values", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    renderPanel();

    const input = await screen.findByDisplayValue("1 Main St, Springfield");
    fireEvent.change(input, { target: { value: "Something else" } });
    expect(await screen.findByText("Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(await screen.findByDisplayValue("1 Main St, Springfield")).toBeTruthy();
    expect(screen.queryByText("Unsaved changes")).toBeFalsy();
  });

  it("shows a toast and keeps the draft on save failure", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockSaveLocation.mockRejectedValue(new Error("boom"));
    renderPanel();

    const input = await screen.findByDisplayValue("1 Main St, Springfield");
    fireEvent.change(input, { target: { value: "2 Main St, Springfield" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Failed to save location.")).toBeTruthy();
    expect(screen.getByDisplayValue("2 Main St, Springfield")).toBeTruthy();
  });
});

describe("LocationSettingsPanel — geocoding search", () => {
  it("searches and lists results on 'Find on map'", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockSearch.mockResolvedValue({ results: [searchResult()], contact_configured: true });
    renderPanel();

    const searchInput = await screen.findByPlaceholderText("e.g. Convention Center, Warsaw");
    fireEvent.change(searchInput, { target: { value: "Downing Street" } });
    fireEvent.click(screen.getByRole("button", { name: "Find on map" }));

    expect(await screen.findByText("10 Downing Street, London")).toBeTruthy();
    expect(mockSearch).toHaveBeenCalledWith("Downing Street");
  });

  it("shows an inline hint (not a toast) when no results are found", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockSearch.mockResolvedValue({ results: [], contact_configured: true });
    renderPanel();

    const searchInput = await screen.findByPlaceholderText("e.g. Convention Center, Warsaw");
    fireEvent.change(searchInput, { target: { value: "Nowhere" } });
    fireEvent.click(screen.getByRole("button", { name: "Find on map" }));

    expect(await screen.findByText("No matching addresses found.")).toBeTruthy();
  });

  it("shows a toast when the search request fails", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockSearch.mockRejectedValue(new Error("rate limited"));
    renderPanel();

    const searchInput = await screen.findByPlaceholderText("e.g. Convention Center, Warsaw");
    fireEvent.change(searchInput, { target: { value: "Downing Street" } });
    fireEvent.click(screen.getByRole("button", { name: "Find on map" }));

    expect(await screen.findByText("Address lookup failed.")).toBeTruthy();
  });

  it("applies a selected result's address and coordinates, and saves with its geocoding_provider", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockSearch.mockResolvedValue({ results: [searchResult()], contact_configured: true });
    mockSaveLocation.mockResolvedValue({
      ...EMPTY_LOCATION,
      formatted_address: "10 Downing Street, London",
      latitude: 51.5034,
      longitude: -0.1276,
      geocoding_provider: "nominatim",
    });
    renderPanel();

    const searchInput = await screen.findByPlaceholderText("e.g. Convention Center, Warsaw");
    fireEvent.change(searchInput, { target: { value: "Downing Street" } });
    fireEvent.click(screen.getByRole("button", { name: "Find on map" }));
    fireEvent.click(await screen.findByText("10 Downing Street, London"));

    expect(await screen.findByDisplayValue("10 Downing Street, London")).toBeTruthy();
    expect(screen.queryByText("10 Downing Street, London", { selector: "button" })).toBeFalsy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      // map_zoom is omitted: the result's zoom (LOCATION_LIMITS.DEFAULT_ZOOM) equals the
      // already-saved EMPTY_LOCATION.map_zoom, so buildEventLocationPatchBody sees no diff.
      expect(mockSaveLocation).toHaveBeenCalledWith("evt-1", {
        formatted_address: "10 Downing Street, London",
        latitude: 51.5034,
        longitude: -0.1276,
        geocoding_provider: "nominatim",
      }),
    );
  });

  it("warns and links to instance settings when the instance has no support contact configured", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockSearch.mockResolvedValue({ results: [searchResult()], contact_configured: false });
    renderPanelWithRoutes();

    const searchInput = await screen.findByPlaceholderText("e.g. Convention Center, Warsaw");
    fireEvent.change(searchInput, { target: { value: "Downing Street" } });
    fireEvent.click(screen.getByRole("button", { name: "Find on map" }));

    expect(await screen.findByText(/No Support contact is configured/)).toBeTruthy();
    fireEvent.click(screen.getByText("Open instance settings"));
    expect(await screen.findByText("instance-settings-page")).toBeTruthy();
  });
});

describe("LocationSettingsPanel — clearing and map availability", () => {
  it("clears coordinates via 'Clear map location'", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Clear map location" }));

    expect(await screen.findByText(/No coordinates set yet/)).toBeTruthy();
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
  it("hides the save footer and the clear-location button for an archived event", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    renderPanel({ isArchived: true });

    await screen.findByDisplayValue("1 Main St, Springfield");
    expect(screen.queryByRole("button", { name: "Save" })).toBeFalsy();
    expect(screen.queryByRole("button", { name: "Clear map location" })).toBeFalsy();
    expect(screen.getByText(/location settings cannot be changed/)).toBeTruthy();
  });
});
