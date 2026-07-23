// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EventsPickerPage } from "../../src/pages/EventsPickerPage.js";

// A plain org admin, not a superadmin — exercises the non-superadmin copy branch of the
// "everything's archived" EmptyState, which AdminPages.errors.test.tsx's file-wide
// superadmin mock can never reach.
const adminAssignments = [{ role: "admin", scope_type: "organization", scope_id: "org-1" }];

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: adminAssignments }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => {
  const connectionState = { reportApiError: vi.fn() };
  return { useConnectionState: () => connectionState };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return { ...actual, fetchAdminEvents: vi.fn() };
});

import { fetchAdminEvents } from "../../src/api/client.js";

afterEach(cleanup);

describe("EventsPickerPage — non-superadmin, everything archived", () => {
  it("shows the 'contact your administrator' copy without an unarchive affordance", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValue([
      {
        id: "evt-arch",
        title: "Archived Summit",
        slug: "archived-summit",
        date: "2026-01-01",
        timezone: "Europe/Warsaw",
        location: null,
        capacity: 100,
        archived_at: "2026-01-01T00:00:00.000Z",
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<EventsPickerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // Every event is archived, so the page auto-switches to the Archived tab once data
    // loads — wait for that to actually happen (not just for the tab button to exist)
    // before clicking Active, otherwise the click can land while "Active" is still the
    // untouched default tab and no-ops, and the later auto-switch overrides it anyway.
    await waitFor(() => {
      expect(screen.getByText("Archived Summit")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("tab", { name: /Active events/ }));

    await waitFor(() => {
      expect(screen.getByText("No active events")).toBeTruthy();
    });
    expect(
      screen.getByText("All events are archived. Contact your administrator if you need help."),
    ).toBeTruthy();
  });

  it("uses the three-column grid when at least four events are active", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({
        id: `evt-${index + 1}`,
        title: `Event ${index + 1}`,
        slug: `event-${index + 1}`,
        date: "2026-01-01",
        timezone: "Europe/Warsaw",
        location: null,
        capacity: 100,
        archived_at: null,
      })),
    );

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<EventsPickerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("Event 4");
    expect(document.querySelector(".event-grid")?.className).toContain("event-grid--cols-3");
  });
});
