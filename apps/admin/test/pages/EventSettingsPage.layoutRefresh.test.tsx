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
  };
});

import { archiveEvent, fetchEventSettings, patchEvent } from "../../src/api/client.js";

const activeEvent = {
  id: "evt-1",
  title: "Summit",
  slug: "summit",
  date: "2026-06-01",
  timezone: "Europe/Warsaw",
  location: "Hall A",
  capacity: 100,
  status: "active" as const,
  organization_name: "Acme Corp",
  active_items: [] as Array<{ id: string; name: string; enabled: boolean }>,
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
});

function renderSettings(eventId = "evt-1") {
  renderWithToast(
    <MemoryRouter initialEntries={[`/admin/events/${eventId}/settings`]}>
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
});
