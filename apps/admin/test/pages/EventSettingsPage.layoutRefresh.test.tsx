// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@admitto/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { EventSettingsPage } from "../../src/pages/EventSettingsPage.js";
import { deferred, makeSuperadminAssignment, mockMatchMedia, renderWithToast } from "../test-utils.js";

// Focused regression coverage for the shared-layout staleness fix: Settings is
// the only page that mutates `archived_at`/other event fields, but every
// sibling page (Attendees, Requirements, Communication, Import, Check-in)
// reads the event from the *same* Outlet context populated once by the
// layout. Without calling the layout's `refreshEvent` after a successful
// save/archive/unarchive, those sibling pages (and the sidebar) kept showing
// the pre-mutation snapshot until a full reload. Kept as its own file
// (instead of extending the large pre-existing EventSettingsPage test suite)
// to avoid merge conflicts with sibling PRs that also touch that file.

const superadminAssignments = [makeSuperadminAssignment()];

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: superadminAssignments }),
}));

const refreshEvent = vi.fn().mockResolvedValue(undefined);
// The layout's own copy of the event (what the archived bar above every page changes); undefined = none.
let mockLayoutEvent: { archived_at: string | null } | undefined;

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useBlocker: () => ({ state: "unblocked", proceed: vi.fn(), reset: vi.fn() }),
    useOutletContext: () => ({ refreshEvent, event: mockLayoutEvent }),
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
  unarchiveEvent,
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
  is_deletable: true,
  deletion_blockers: [] as string[],
  admitted_count: 0,
  issued_items_count: 0,
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
  google_maps_url_override: null,
  apple_maps_url_override: null,
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
  mockLayoutEvent = undefined;
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

describe("EventSettingsPage when the archived bar restores the event", () => {
  const archivedAt = "2026-07-02T06:03:00.000Z";

  function tree() {
    return (
      <ToastProvider>
        <MemoryRouter initialEntries={["/admin/events/evt-1/settings"]}>
          <Routes>
            <Route path="/admin/events/:eventId/settings" element={<EventSettingsPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );
  }

  it("reads the event again, so the fields unlock without a reload", async () => {
    mockLayoutEvent = { archived_at: archivedAt };
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, status: "archived", archived_at: archivedAt });
    const view = render(tree());

    const title = (await screen.findByLabelText("Event title")) as HTMLInputElement;
    expect(title.disabled).toBe(true);
    expect(fetchEventSettings).toHaveBeenCalledTimes(1);

    // The bar restores the event: the layout's copy changes, this page's own snapshot does not.
    mockLayoutEvent = { archived_at: null };
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    view.rerender(tree());

    await waitFor(() => expect((screen.getByLabelText("Event title") as HTMLInputElement).disabled).toBe(false));
    expect(fetchEventSettings).toHaveBeenCalledTimes(2);
  });

  it("still reads the event again when the restore lands before the first read has finished", async () => {
    mockLayoutEvent = { archived_at: archivedAt };
    const firstRead = deferred<typeof activeEvent>();
    vi.mocked(fetchEventSettings).mockReturnValueOnce(firstRead.promise);
    const view = render(tree());

    // The bar restores while the page is still waiting for its first read.
    mockLayoutEvent = { archived_at: null };
    view.rerender(tree());
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    await act(async () => {
      firstRead.resolve({ ...activeEvent, status: "archived", archived_at: archivedAt });
    });

    await waitFor(() => expect((screen.getByLabelText("Event title") as HTMLInputElement).disabled).toBe(false));
    expect(fetchEventSettings).toHaveBeenCalledTimes(2);
  });

  it("reads the event again only once when the layout stays out of step with the server", async () => {
    mockLayoutEvent = { archived_at: null };
    // A new object on every read, as the real request gives: the same object would not render again.
    vi.mocked(fetchEventSettings).mockImplementation(async () => ({
      ...activeEvent,
      status: "archived",
      archived_at: archivedAt,
    }));
    render(tree());

    await waitFor(() => expect(fetchEventSettings).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(fetchEventSettings).toHaveBeenCalledTimes(2);
  });

  it("does not read the event a second time during its own Restore from the Danger zone", async () => {
    mockLayoutEvent = { archived_at: archivedAt };
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, status: "archived", archived_at: archivedAt });
    vi.mocked(unarchiveEvent).mockResolvedValueOnce(undefined);
    // The page reads the restored event first; the layout refresh is still pending, so the two disagree for a moment.
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    const layoutRefresh = deferred<void>();
    refreshEvent.mockReturnValueOnce(layoutRefresh.promise);
    render(tree());

    fireEvent.click(await screen.findByRole("tab", { name: "Danger zone" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore event" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(refreshEvent).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(fetchEventSettings).toHaveBeenCalledTimes(2);

    await act(async () => {
      layoutRefresh.resolve();
    });
    expect(fetchEventSettings).toHaveBeenCalledTimes(2);
  });

  it("does not read the event again when the layout still agrees with the page", async () => {
    mockLayoutEvent = { archived_at: null };
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    const view = render(tree());

    await screen.findByLabelText("Event title");
    view.rerender(tree());
    await screen.findByLabelText("Event title");

    expect(fetchEventSettings).toHaveBeenCalledTimes(1);
  });
});
