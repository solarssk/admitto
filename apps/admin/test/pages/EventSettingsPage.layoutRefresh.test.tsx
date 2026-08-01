// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { EventSettingsPage } from "../../src/pages/EventSettingsPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";

// Focused regression coverage for the shared-layout staleness fix: Settings is
// the only page that mutates `archived_at`/other event fields, but every
// sibling page (Attendees, Requirements, Communication, Import, Check-in)
// reads the event from the *same* Outlet context populated once by the
// layout. Without calling the layout's `refreshEvent` after a successful
// save/archive/unarchive, those sibling pages (and the sidebar) kept showing
// the pre-mutation snapshot until a full reload. Kept as its own file
// (instead of extending the large pre-existing EventSettingsPage test suite)
// to avoid merge conflicts with sibling PRs that also touch that file.

const superadminAssignments = [{ role: "superadmin", scope_type: "instance", scope_id: null }];

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: superadminAssignments }),
}));

const refreshEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useBlocker: () => ({ state: "unblocked", proceed: vi.fn(), reset: vi.fn() }),
    useOutletContext: () => ({ refreshEvent }),
  };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchEventSettings: vi.fn(),
    patchEvent: vi.fn(),
    archiveEvent: vi.fn(),
    unarchiveEvent: vi.fn(),
    exportEventPii: vi.fn(),
    fetchEventLocation: vi.fn(),
    fetchMapTileConfig: vi.fn(),
    saveEventLocation: vi.fn(),
    searchGeocoding: vi.fn(),
    reverseGeocoding: vi.fn(),
    fetchTimezoneForCoordinates: vi.fn(),
  };
});

vi.mock("../../src/settings/MapPicker.js", () => ({
  MapPicker: () => <div data-testid="map-picker" />,
}));

import {
  archiveEvent,
  fetchEventLocation,
  fetchEventSettings,
  fetchMapTileConfig,
  fetchTimezoneForCoordinates,
  patchEvent,
  saveEventLocation,
  searchGeocoding,
  reverseGeocoding,
} from "../../src/api/client.js";

const activeEvent = {
  id: "evt-1",
  title: "Summit",
  slug: "summit",
  date: "2026-06-01",
  timezone: "Europe/Warsaw",
  capacity: 100,
  status: "active" as const,
  organization_name: "Acme Corp",
  created_at: "2026-01-01T00:00:00.000Z",
  archived_at: null as string | null,
  active_items: [] as Array<{ id: string; name: string; enabled: boolean }>,
};

const emptyLocation = {
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

const mapTileConfig = {
  enabled: true,
  tile_url: "https://tile.example/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors",
  max_zoom: 19,
  contact_configured: true,
};

// ScrollFadeTabs (wrapping this page's own tab strip) scrolls its active tab into view on
// mount/change - jsdom does not implement scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// The page's Save button label shortens on mobile via useIsDesktop(), which reads
// window.matchMedia - jsdom doesn't implement it. Default to desktop so existing
// "Save changes" label assertions keep working unchanged.
beforeEach(() => {
  mockMatchMedia(true);
  vi.mocked(fetchEventLocation).mockResolvedValue(emptyLocation);
  vi.mocked(fetchMapTileConfig).mockResolvedValue(mapTileConfig);
  vi.mocked(saveEventLocation).mockResolvedValue(emptyLocation);
  vi.mocked(searchGeocoding).mockResolvedValue({ results: [], contact_configured: true });
  vi.mocked(reverseGeocoding).mockResolvedValue({ result: null, contact_configured: true });
  vi.mocked(fetchTimezoneForCoordinates).mockResolvedValue({ timezone: null });
});

function renderSettings(entry = "/admin/events/evt-1/settings") {
  renderWithToast(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/events/:eventId/settings" element={<EventSettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("EventSettingsPage layout refresh after mutations", () => {
  it("refreshes the shared layout event after saving a field change", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(patchEvent).mockResolvedValueOnce({ event: { ...activeEvent, title: "Summit 2026" } });
    renderSettings();

    const titleInput = await screen.findByLabelText("Event title");
    fireEvent.change(titleInput, { target: { value: "Summit 2026" } });

    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(patchEvent).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(refreshEvent).toHaveBeenCalledTimes(1);
    });
  });

  it("refreshes the shared layout event after archiving", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(archiveEvent).mockResolvedValueOnce(undefined);
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      status: "archived",
    });
    renderSettings();

    await screen.findByRole("tab", { name: "Danger zone" });
    fireEvent.click(screen.getByRole("tab", { name: "Danger zone" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Archive event" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Archive event" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(archiveEvent).toHaveBeenCalledWith("evt-1");
    });
    await waitFor(() => {
      expect(refreshEvent).toHaveBeenCalledTimes(1);
    });
  });

  it("refreshes the shared layout event after saving the Location tab", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(saveEventLocation).mockResolvedValueOnce({
      ...emptyLocation,
      directions_text: "Use the east entrance.",
    });
    renderSettings("/admin/events/evt-1/settings?tab=location");

    fireEvent.change(await screen.findByLabelText("Directions"), {
      target: { value: "Use the east entrance." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saveEventLocation).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(refreshEvent).toHaveBeenCalledTimes(1);
    });
  });

  it("refreshes the shared layout event after applying a suggested timezone", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(fetchEventLocation).mockResolvedValueOnce({
      ...emptyLocation,
      latitude: 40.7128,
      longitude: -74.006,
      venue_name: "New York Hall",
    });
    vi.mocked(fetchTimezoneForCoordinates).mockResolvedValueOnce({ timezone: "America/New_York" });
    vi.mocked(patchEvent).mockResolvedValueOnce({
      event: { ...activeEvent, timezone: "America/New_York" },
    });
    renderSettings("/admin/events/evt-1/settings?tab=location");

    fireEvent.click(await screen.findByRole("button", { name: "Use" }));

    await waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith("evt-1", { timezone: "America/New_York" });
    });
    await waitFor(() => {
      expect(refreshEvent).toHaveBeenCalledTimes(1);
    });
  });
});
