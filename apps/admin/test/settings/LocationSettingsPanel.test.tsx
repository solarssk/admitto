// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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

vi.mock("../../src/settings/MapPicker.js", () => ({
  MapPicker: ({
    disabled,
    onPick,
    onZoomChange,
  }: {
    disabled?: boolean;
    onPick: (latitude: number, longitude: number) => void;
    onZoomChange?: (zoom: number) => void;
  }) => (
    <div>
      <button
        type="button"
        data-testid="map-picker"
        disabled={disabled}
        onClick={() => onPick(40.7128, -74.006)}
      >
        Pick New York
      </button>
      <button type="button" data-testid="map-zoom" onClick={() => onZoomChange?.(12)}>
        Zoom out
      </button>
    </div>
  ),
}));

import {
  fetchEventLocation,
  fetchMapTileConfig,
  fetchTimezoneForCoordinates,
  reverseGeocoding,
  saveEventLocation,
  searchGeocoding,
} from "../../src/api/client.js";

const mockFetchLocation = vi.mocked(fetchEventLocation);
const mockSaveLocation = vi.mocked(saveEventLocation);
const mockSearch = vi.mocked(searchGeocoding);
const mockReverse = vi.mocked(reverseGeocoding);
const mockFetchTiles = vi.mocked(fetchMapTileConfig);
const mockFetchTimezone = vi.mocked(fetchTimezoneForCoordinates);

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
  google_maps_url_override: null,
  apple_maps_url_override: null,
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
  google_maps_url_override: null,
  apple_maps_url_override: null,
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPanel(
  props: Partial<{
    eventId: string;
    isArchived: boolean;
    eventTimezone: string;
    onDirtyChange: (d: boolean) => void;
    onSavingChange: (s: boolean) => void;
    onLocationSaved: () => Promise<void> | void;
    onApplyTimezone: (timezone: string) => Promise<void> | void;
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
  mockFetchTimezone.mockReset();
  mockFetchTimezone.mockResolvedValue({ timezone: "Europe/London" });
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
      expect(document.querySelector(".location-map-footer__coords")?.textContent?.trim()).toBe("-");
    });
  });

  it("shows a retry link on load failure", async () => {
    mockFetchLocation.mockRejectedValueOnce(new Error("network down")).mockResolvedValue(SAVED_LOCATION);
    renderPanel();

    fireEvent.click(await screen.findByText("Retry"));
    expect(await screen.findByDisplayValue("Springfield Hall")).toBeTruthy();
  });

  it("ignores a stale aborted load rather than showing its error", async () => {
    const first = createDeferred<EventLocationDto>();
    mockFetchLocation.mockImplementationOnce(() => first.promise).mockResolvedValueOnce(SAVED_LOCATION);
    const rendered = renderPanel({ eventId: "evt-1" });

    rendered.unmount();
    renderPanel({ eventId: "evt-2" });
    first.reject(new Error("stale request failed"));

    expect(await screen.findByDisplayValue("Springfield Hall")).toBeTruthy();
    expect(screen.queryByText("Failed to load location settings.")).toBeNull();
  });

  it("does not apply a successful location response after its load is aborted", async () => {
    const location = createDeferred<EventLocationDto>();
    mockFetchLocation.mockReturnValueOnce(location.promise);
    const rendered = renderPanel();
    await waitFor(() => expect(mockFetchLocation).toHaveBeenCalled());

    rendered.unmount();
    location.resolve(SAVED_LOCATION);
    await act(async () => {
      await location.promise;
    });

    expect(screen.queryByDisplayValue("Springfield Hall")).toBeNull();
  });
});

describe("LocationSettingsPanel — dirty state and save", () => {
  it("reports dirty after a venue name edit and clears it after a successful save", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockSaveLocation.mockResolvedValue({
      ...SAVED_LOCATION,
      venue_name: "New Hall",
      geocoding_provider: null,
      geocoded_at: null,
      address_components: { ...SAVED_LOCATION.address_components!, object_name: "New Hall" },
    });
    const onDirtyChange = vi.fn();
    renderPanel({ onDirtyChange });

    const input = await screen.findByDisplayValue("Springfield Hall");
    fireEvent.change(input, { target: { value: "New Hall" } });

    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockSaveLocation).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({
          venue_name: "New Hall",
          geocoding_provider: null,
          address_components: expect.objectContaining({ object_name: "New Hall" }),
        }),
      ),
    );
    expect(mockSaveLocation.mock.calls[0]?.[1]).not.toHaveProperty("latitude");
    expect(mockSaveLocation.mock.calls[0]?.[1]).not.toHaveProperty("longitude");
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
    expect(await screen.findByText("From OpenStreetMap")).toBeTruthy();
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

  it("uses a selected result's formatted address when it has no venue name", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockSearch.mockResolvedValue({
      results: [searchResult({ name: undefined, formatted_address: "Address-only result" })],
      contact_configured: true,
    });
    renderPanel();

    fireEvent.change(await screen.findByLabelText("Venue name or address"), { target: { value: "Address-only" } });
    fireEvent.click(await screen.findByRole("button", { name: /Address-only result/ }));

    expect(await screen.findByDisplayValue("Address-only result")).toBeTruthy();
  });

  it("keeps pin and address when the venue text is edited after a pick, but clears verified", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    renderPanel();

    await screen.findByDisplayValue("Springfield Hall");
    expect(await screen.findByText("From OpenStreetMap")).toBeTruthy();
    expect(screen.getByText("51.50740, -0.12780")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Venue name or address"), {
      target: { value: "Springfield Hall Annex" },
    });

    expect(screen.getByDisplayValue("Springfield Hall Annex")).toBeTruthy();
    expect(screen.queryByText("From OpenStreetMap")).toBeFalsy();
    expect(screen.getByText("Set manually")).toBeTruthy();
    expect(screen.getByText("51.50740, -0.12780")).toBeTruthy();
  });

  it("syncs object_name and clears geocoding_provider on a venue-name-only save", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockSaveLocation.mockResolvedValue({
      ...SAVED_LOCATION,
      venue_name: "Springfield Hall Annex",
      geocoding_provider: null,
      geocoded_at: null,
      address_components: {
        ...SAVED_LOCATION.address_components!,
        object_name: "Springfield Hall Annex",
      },
    });
    renderPanel();

    await screen.findByDisplayValue("Springfield Hall");
    fireEvent.change(screen.getByLabelText("Venue name or address"), {
      target: { value: "Springfield Hall Annex" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockSaveLocation).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({
          venue_name: "Springfield Hall Annex",
          geocoding_provider: null,
          address_components: expect.objectContaining({
            object_name: "Springfield Hall Annex",
            street: "1 Main St",
          }),
        }),
      ),
    );
    expect(mockSaveLocation.mock.calls[0]?.[1]).not.toHaveProperty("latitude");
    expect(mockSaveLocation.mock.calls[0]?.[1]).not.toHaveProperty("longitude");
  });

  it("re-selecting the same coordinates restores Verified and saves geocoding_provider", async () => {
    const unverified: EventLocationDto = {
      ...SAVED_LOCATION,
      geocoding_provider: null,
      geocoded_at: null,
    };
    mockFetchLocation.mockResolvedValue(unverified);
    mockSearch.mockResolvedValue({
      results: [
        searchResult({
          name: "Springfield Hall",
          formatted_address: "1 Main St, Springfield",
          latitude: 51.5074,
          longitude: -0.1278,
        }),
      ],
      contact_configured: true,
    });
    mockSaveLocation.mockResolvedValue({
      ...unverified,
      geocoding_provider: "nominatim",
      geocoded_at: "2026-08-02T00:00:00.000Z",
    });
    renderPanel();

    await screen.findByDisplayValue("Springfield Hall");
    expect(screen.getByText("Set manually")).toBeTruthy();
    expect(screen.queryByText("From OpenStreetMap")).toBeFalsy();

    fireEvent.change(screen.getByLabelText("Venue name or address"), {
      target: { value: "Springfield" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Springfield Hall/ }));

    expect(await screen.findByText("From OpenStreetMap")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockSaveLocation).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({
          geocoding_provider: "nominatim",
        }),
      ),
    );
    // Same pin: save must not require a coordinate rewrite to stamp provenance.
    const body = mockSaveLocation.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(body.latitude).toBeUndefined();
    expect(body.longitude).toBeUndefined();
  });

  it("clears object_name when the venue field is whitespace-only", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockSaveLocation.mockResolvedValue({
      ...SAVED_LOCATION,
      venue_name: "   ",
      geocoding_provider: null,
      geocoded_at: null,
      address_components: {
        ...SAVED_LOCATION.address_components!,
        object_name: null,
      },
    });
    renderPanel();

    await screen.findByDisplayValue("Springfield Hall");
    fireEvent.change(screen.getByLabelText("Venue name or address"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockSaveLocation).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({
          address_components: expect.objectContaining({
            object_name: null,
            street: "1 Main St",
          }),
        }),
      ),
    );
  });

  it("applies a selected result immediately so Save during reverse enrichment keeps the pin", async () => {
    const slowReverse = createDeferred<Awaited<ReturnType<typeof reverseGeocoding>>>();
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockSearch.mockResolvedValue({ results: [searchResult()], contact_configured: true });
    mockReverse.mockReturnValueOnce(slowReverse.promise);
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
    expect(await screen.findByText("51.50340, -0.12760")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockSaveLocation).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({
          venue_name: "10 Downing Street",
          latitude: 51.5034,
          longitude: -0.1276,
          geocoding_provider: "nominatim",
        }),
      ),
    );

    slowReverse.resolve({
      contact_configured: true,
      result: searchResult({
        formatted_address: "Enriched address",
        components: {
          object_name: "10 Downing Street",
          street: "Downing Street",
          postcode: null,
          city: "London",
          region: null,
          country: "UK",
        },
      }),
    });
    await act(async () => {
      await slowReverse.promise;
    });
  });

  it("persists map zoom changes from the map control", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockSaveLocation.mockResolvedValue({ ...SAVED_LOCATION, map_zoom: 12 });
    renderPanel();

    await screen.findByDisplayValue("Springfield Hall");
    fireEvent.click(screen.getByTestId("map-zoom"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockSaveLocation).toHaveBeenCalledWith("evt-1", expect.objectContaining({ map_zoom: 12 })),
    );
  });

  it("does not create a new draft when the map reports the current zoom again", async () => {
    mockFetchLocation.mockResolvedValue({ ...SAVED_LOCATION, map_zoom: 12 });
    renderPanel();

    await screen.findByDisplayValue("Springfield Hall");
    fireEvent.click(screen.getByTestId("map-zoom"));
    fireEvent.click(screen.getByTestId("map-zoom"));

    expect(screen.getByTestId("map-zoom")).toBeTruthy();
  });

  it("does not let a slow reverse lookup overwrite a later selected venue", async () => {
    const slowReverse = createDeferred<Awaited<ReturnType<typeof reverseGeocoding>>>();
    const first = searchResult({ name: "First venue", formatted_address: "First address" });
    const second = searchResult({
      name: "Second venue",
      formatted_address: "Second address",
      latitude: 52.2297,
      longitude: 21.0122,
      components: {
        object_name: "Second venue",
        street: "Main Street 2",
        postcode: "00-001",
        city: "Warsaw",
        region: null,
        country: "Poland",
      },
    });
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockSearch.mockResolvedValueOnce({ results: [first], contact_configured: true });
    mockSearch.mockResolvedValueOnce({ results: [second], contact_configured: true });
    mockReverse.mockReturnValueOnce(slowReverse.promise);
    renderPanel();

    const input = await screen.findByLabelText("Venue name or address");
    fireEvent.change(input, { target: { value: "First venue" } });
    fireEvent.click(await screen.findByRole("button", { name: /First venue/ }));

    fireEvent.change(input, { target: { value: "Second venue" } });
    fireEvent.click(await screen.findByRole("button", { name: /Second venue/ }));
    expect(await screen.findByDisplayValue("Second venue")).toBeTruthy();

    slowReverse.resolve({
      contact_configured: true,
      result: searchResult({
        name: "First venue",
        formatted_address: "Late first address",
        components: { object_name: "First venue", street: "Late Street", postcode: null, city: null, region: null, country: null },
      }),
    });
    // Let the late reverse settle; the later selection must still win.
    await act(async () => {
      await slowReverse.promise;
    });
    expect(await screen.findByDisplayValue("Second venue")).toBeTruthy();
    expect(screen.getByText("52.22970, 21.01220")).toBeTruthy();
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
      expect(document.querySelector(".location-map-footer__coords")?.textContent?.trim()).toBe("-");
    });
    expect(screen.queryByText("From OpenStreetMap")).toBeFalsy();
    expect(screen.queryByText("Set manually")).toBeFalsy();
    expect(await screen.findByText("Unsaved changes")).toBeTruthy();
  });

  it("no-ops Save when there are no draft changes", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    renderPanel();
    await screen.findByDisplayValue("Springfield Hall");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSaveLocation).not.toHaveBeenCalled();
  });

  it("ignores copy-link clicks after the pin has been cleared", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    renderPanel();

    await screen.findByDisplayValue("Springfield Hall");
    fireEvent.click(screen.getByRole("button", { name: "Clear map" }));
    await waitFor(() => {
      expect(document.querySelector(".location-map-footer__coords")?.textContent?.trim()).toBe("-");
    });

    const copy = screen.getByRole("button", { name: "Copy Google Maps link" }) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    fireEvent.click(copy);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("shows a notice instead of the map when tiles are disabled", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockFetchTiles.mockResolvedValue({ ...TILE_CONFIG, enabled: false });
    renderPanel();

    expect(await screen.findByText(/Map display is disabled for this instance/)).toBeTruthy();
  });

  it("keeps a manually picked pin but clears its address when reverse geocoding has no match", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockReverse.mockResolvedValue({ result: null, contact_configured: true });
    renderPanel();

    fireEvent.click(await screen.findByTestId("map-picker"));

    expect(await screen.findByText("40.71280, -74.00600")).toBeTruthy();
    expect(screen.getByLabelText("Address details").textContent).not.toContain("Springfield");
    expect(screen.getByText("Set manually")).toBeTruthy();
    expect(screen.queryByText("From OpenStreetMap")).toBeFalsy();
  });

  it("fills an empty venue name from reverse geocoding after a manual pin pick", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockReverse.mockResolvedValue({
      result: searchResult({
        name: "Empire State",
        formatted_address: "Empire State Building, New York",
        latitude: 40.7128,
        longitude: -74.006,
      }),
      contact_configured: true,
    });
    renderPanel();

    fireEvent.click(await screen.findByTestId("map-picker"));

    expect(await screen.findByDisplayValue("Empire State")).toBeTruthy();
    expect(await screen.findByText("From OpenStreetMap")).toBeTruthy();
  });

  it("keeps the existing venue name and restores the default zoom after a map pick", async () => {
    mockFetchLocation.mockResolvedValue({ ...SAVED_LOCATION, map_zoom: 0 });
    mockReverse.mockResolvedValue({
      result: searchResult({ name: "Different OSM name", formatted_address: "New address, New York" }),
      contact_configured: true,
    });
    mockSaveLocation.mockResolvedValue({ ...SAVED_LOCATION, map_zoom: 15 });
    renderPanel();

    fireEvent.click(await screen.findByTestId("map-picker"));
    expect(await screen.findByDisplayValue("Springfield Hall")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockSaveLocation).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({ map_zoom: 15 }),
      ),
    );
  });

  it("does not restore an address when a slow reverse lookup resolves after Clear map", async () => {
    const slowReverse = createDeferred<Awaited<ReturnType<typeof reverseGeocoding>>>();
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockReverse.mockReturnValueOnce(slowReverse.promise);
    renderPanel();

    fireEvent.click(await screen.findByTestId("map-picker"));
    fireEvent.click(screen.getByRole("button", { name: "Clear map" }));
    slowReverse.resolve({
      result: searchResult({ formatted_address: "Late address, New York" }),
      contact_configured: true,
    });
    await act(async () => {
      await slowReverse.promise;
    });

    expect(document.querySelector(".location-map-footer__coords")?.textContent?.trim()).toBe("-");
    expect(screen.getByLabelText("Address details").textContent).not.toContain("Late address");
  });

  it("does not clear later state when a slow reverse lookup rejects after Clear map", async () => {
    const slowReverse = createDeferred<Awaited<ReturnType<typeof reverseGeocoding>>>();
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockReverse.mockReturnValueOnce(slowReverse.promise);
    renderPanel();

    fireEvent.click(await screen.findByTestId("map-picker"));
    fireEvent.click(screen.getByRole("button", { name: "Clear map" }));
    slowReverse.reject(new Error("late reverse failure"));
    await act(async () => {
      try {
        await slowReverse.promise;
      } catch {
        // The component intentionally ignores this stale rejection.
      }
    });

    expect(document.querySelector(".location-map-footer__coords")?.textContent?.trim()).toBe("-");
  });

  it("uses formatted_address as venue name when reverse has no name", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockReverse.mockResolvedValue({
      result: searchResult({
        name: undefined,
        formatted_address: "Unnamed pin, New York",
        latitude: 40.7128,
        longitude: -74.006,
      }),
      contact_configured: true,
    });
    renderPanel();

    fireEvent.click(await screen.findByTestId("map-picker"));
    expect(await screen.findByDisplayValue("Unnamed pin, New York")).toBeTruthy();
  });

  it("keeps a manually picked pin and clears stale address after a reverse failure", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockReverse.mockRejectedValue(new Error("reverse unavailable"));
    mockSaveLocation.mockResolvedValue({
      ...SAVED_LOCATION,
      latitude: 40.7128,
      longitude: -74.006,
      formatted_address: null,
      address_components: null,
    });
    renderPanel();

    fireEvent.click(await screen.findByTestId("map-picker"));
    expect(await screen.findByText("40.71280, -74.00600")).toBeTruthy();
    expect(screen.getByLabelText("Address details").textContent).not.toContain("Springfield");
    expect(screen.getByText("Set manually")).toBeTruthy();
    expect(screen.queryByText("From OpenStreetMap")).toBeFalsy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockSaveLocation).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({
          latitude: 40.7128,
          longitude: -74.006,
          formatted_address: null,
          address_components: null,
        }),
      ),
    );
  });
});

describe("LocationSettingsPanel — map links and timezone", () => {
  it("copies Google and Apple Maps links", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    renderPanel();

    await screen.findByDisplayValue("Springfield Hall");
    fireEvent.click(screen.getByRole("button", { name: "Copy Google Maps link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("google.com/maps")));
    expect(await screen.findByText("Google Maps link copied.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy Apple Maps link" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("maps.apple.com")));
    expect(await screen.findByText("Apple Maps link copied.")).toBeTruthy();
  });

  it("opens Fix link modal and copies a manual Google override", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const override = "https://www.google.com/maps/place/Custom+Hall";
    mockFetchLocation.mockResolvedValue({
      ...SAVED_LOCATION,
      google_maps_url_override: override,
      apple_maps_url_override: null,
    });
    renderPanel();

    await screen.findByDisplayValue("Springfield Hall");
    expect(screen.getByText(/Using a manually entered link instead of the pin-built/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy Google Maps link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(override));

    fireEvent.click(screen.getByRole("button", { name: "Pin wrong? Fix link" }));
    expect(await screen.findByRole("heading", { name: "Fix a wrong map link" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove overrides" }));
    await waitFor(() =>
      expect(screen.queryByText(/Using a manually entered link instead of the pin-built/)).toBeFalsy(),
    );
  });

  it("applies Fix link modal Save to the draft without calling the API yet", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    renderPanel();

    await screen.findByDisplayValue("Springfield Hall");
    fireEvent.click(screen.getByRole("button", { name: "Pin wrong? Fix link" }));
    const googleInput = await screen.findByLabelText("Google Maps link");
    fireEvent.change(googleInput, {
      target: { value: "https://maps.app.goo.gl/example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save links" }));
    await waitFor(() =>
      expect(screen.getByText(/Using a manually entered link instead of the pin-built/)).toBeTruthy(),
    );
    expect(mockSaveLocation).not.toHaveBeenCalled();
  });

  it("removes both Maps overrides from one notice action", async () => {
    mockFetchLocation.mockResolvedValue({
      ...SAVED_LOCATION,
      google_maps_url_override: "https://www.google.com/maps/place/Custom",
      apple_maps_url_override: "https://maps.apple.com/?ll=1,2",
    });
    renderPanel();

    await screen.findByDisplayValue("Springfield Hall");
    expect(screen.getByText(/Using a manually entered link instead of the pin-built/)).toBeTruthy();
    expect(screen.getAllByText(/Using a manually entered link/).length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove override" }));
    await waitFor(() =>
      expect(screen.queryByText(/Using a manually entered link instead of the pin-built/)).toBeFalsy(),
    );
  });

  it("uses the formatted address, then coordinates alone, as the Google Maps link label", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mockFetchLocation.mockResolvedValue({
      ...SAVED_LOCATION,
      venue_name: null,
      formatted_address: "1 Main St, Springfield",
    });
    renderPanel();

    await screen.findByLabelText("Venue name or address");
    fireEvent.click(screen.getByRole("button", { name: "Copy Google Maps link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]?.[0]).toContain(encodeURIComponent("1 Main St, Springfield"));

    mockFetchLocation.mockResolvedValue({
      ...SAVED_LOCATION,
      venue_name: null,
      formatted_address: null,
    });
    cleanup();
    renderPanel();
    await screen.findByLabelText("Venue name or address");
    fireEvent.click(screen.getByRole("button", { name: "Copy Google Maps link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1]?.[0]).not.toContain("q=");
  });

  it("offers the coordinate timezone and applies it", async () => {
    const onApplyTimezone = vi.fn().mockResolvedValue(undefined);
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockFetchTimezone.mockResolvedValue({ timezone: "America/New_York" });
    renderPanel({ onApplyTimezone });

    expect(await screen.findByText(/This address seems to be in/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    await waitFor(() => expect(onApplyTimezone).toHaveBeenCalledWith("America/New_York"));
    expect(await screen.findByText("Event timezone set to America/New_York.")).toBeTruthy();
  });

  it("toasts when applying the suggested timezone fails", async () => {
    const onApplyTimezone = vi.fn().mockRejectedValue(new Error("timezone patch failed"));
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockFetchTimezone.mockResolvedValue({ timezone: "America/New_York" });
    renderPanel({ onApplyTimezone });

    fireEvent.click(await screen.findByRole("button", { name: "Use" }));
    expect(await screen.findByText("Failed to update timezone.")).toBeTruthy();
  });

  it("toasts when copying a map link fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    renderPanel();

    await screen.findByDisplayValue("Springfield Hall");
    fireEvent.click(screen.getByRole("button", { name: "Copy Google Maps link" }));
    expect(await screen.findByText("Could not copy link.")).toBeTruthy();
  });

  it("clears the timezone suggestion when the lookup fails", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockFetchTimezone
      .mockResolvedValueOnce({ timezone: "America/New_York" })
      .mockRejectedValueOnce(new Error("tz unavailable"));
    renderPanel();

    expect(await screen.findByText(/This address seems to be in/)).toBeTruthy();
    // Nudge the pin so the effect re-runs and hits the rejection path.
    fireEvent.click(screen.getByTestId("map-picker"));
    await waitFor(() => {
      expect(screen.queryByText(/This address seems to be in/)).toBeNull();
    });
  });

  it("keeps the newer timezone suggestion when an aborted earlier lookup rejects", async () => {
    const firstLookup = createDeferred<{ timezone: string | null }>();
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockFetchTimezone
      .mockReturnValueOnce(firstLookup.promise)
      .mockResolvedValueOnce({ timezone: "America/New_York" });
    renderPanel({ eventTimezone: "Europe/Warsaw" });

    fireEvent.click(await screen.findByTestId("map-picker"));
    expect((await screen.findByText(/This address seems to be in/)).textContent).toContain("America/New_York");

    firstLookup.reject(new Error("aborted lookup failed"));
    await act(async () => {
      try {
        await firstLookup.promise;
      } catch {
        // The effect's aborted request deliberately cannot clear the newer suggestion.
      }
    });
    expect(screen.getByText(/This address seems to be in/).textContent).toContain("America/New_York");
  });
});

describe("LocationSettingsPanel — editable fields", () => {
  it("saves directions and accessibility text", async () => {
    mockFetchLocation.mockResolvedValue(EMPTY_LOCATION);
    mockSaveLocation.mockResolvedValue({
      ...EMPTY_LOCATION,
      directions_text: "Use the east entrance.",
      accessibility_text: "Step-free entrance.",
    });
    renderPanel();

    fireEvent.change(await screen.findByLabelText("Directions"), { target: { value: "Use the east entrance." } });
    fireEvent.change(screen.getByLabelText("Accessibility"), { target: { value: "Step-free entrance." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockSaveLocation).toHaveBeenCalledWith("evt-1", {
        directions_text: "Use the east entrance.",
        accessibility_text: "Step-free entrance.",
      }),
    );
  });

  it("disables the map while a location save is pending", async () => {
    const pendingSave = createDeferred<EventLocationDto>();
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    mockSaveLocation.mockReturnValue(pendingSave.promise);
    renderPanel();

    fireEvent.change(await screen.findByLabelText("Directions"), { target: { value: "New directions" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect((screen.getByTestId("map-picker") as HTMLButtonElement).disabled).toBe(true));
    pendingSave.resolve({ ...SAVED_LOCATION, directions_text: "New directions" });
    await screen.findByText("Location saved.");
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

  it("disables map, fields, and copied links for an archived event", async () => {
    mockFetchLocation.mockResolvedValue(SAVED_LOCATION);
    renderPanel({ isArchived: true });

    expect((await screen.findByLabelText("Venue name or address") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Directions") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByTestId("map-picker") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Copy Google Maps link" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
