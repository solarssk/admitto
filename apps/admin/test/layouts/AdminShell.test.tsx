// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useOutletContext } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventDto } from "../../src/api/types.js";
import { AdminShell } from "../../src/layouts/AdminShell.js";

let mockAssignments = [{ role: "superadmin", scope_type: "instance" as const, scope_id: null }];

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: mockAssignments }),
}));

vi.mock("../../src/layouts/StaffShell.js", () => ({
  StaffShell: ({
    sidebar,
    children,
    eventId,
  }: {
    sidebar: React.ReactNode;
    children: React.ReactNode;
    eventId?: string;
  }) => (
    <div>
      <nav data-testid="sidebar">{sidebar}</nav>
      <main data-testid="main" data-event-id={eventId ?? ""}>
        {children}
      </main>
    </div>
  ),
}));

const sampleEvent: EventDto = {
  id: "evt-1",
  title: "Spring Gala",
  slug: "spring-gala",
  date: "2026-09-15",
  timezone: "Europe/Warsaw",
  location: "Warsaw Expo",
  archived_at: null,
};

/** Minimal nested-route probe used only to assert the Outlet context shape. */
function ConsumerProbe() {
  const { refreshEvent } = useOutletContext<{ refreshEvent: () => Promise<void> }>();
  return (
    <button type="button" onClick={() => void refreshEvent()}>
      trigger refresh
    </button>
  );
}

function renderShell(event: EventDto = sampleEvent, refreshEvent: () => Promise<void> = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={["/admin/events/evt-1/overview"]}>
      <Routes>
        <Route
          path="/admin/events/:eventId/*"
          element={<AdminShell event={event} refreshEvent={refreshEvent} />}
        >
          <Route path="overview" element={<div>overview page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("AdminShell", () => {
  it("renders event metadata and a Google Maps link when location is set", () => {
    renderShell();
    expect(screen.getByText("Spring Gala")).toBeTruthy();
    const mapsLink = screen.getByRole("link", { name: "Warsaw Expo" });
    expect(mapsLink.getAttribute("href")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Warsaw%20Expo",
    );
    expect(mapsLink.getAttribute("title")).toBe("Open in Google Maps");
  });

  it("omits the location row when location is empty", () => {
    renderShell({ ...sampleEvent, location: null });
    expect(screen.queryByRole("link", { name: "Warsaw Expo" })).toBeNull();
    expect(screen.queryByTitle("Open in Google Maps")).toBeNull();
  });

  it("renders shared instance sidebar foot links", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "All events" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "My account" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Attendees" }).getAttribute("href")).toBe(
      "/admin/events/evt-1/attendees",
    );
  });

  it("forwards the route's eventId to StaffShell (for SystemStatus's event-aware Email sending row)", () => {
    renderShell();
    expect(screen.getByTestId("main").dataset.eventId).toBe("evt-1");
  });

  it("marks live lifecycle segments as links and defers upcoming segments", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Passes" })).toHaveProperty("disabled", true);
  });

  it("threads refreshEvent through to the nested route via Outlet context", () => {
    const refreshEvent = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter initialEntries={["/admin/events/evt-1/overview"]}>
        <Routes>
          <Route
            path="/admin/events/:eventId/*"
            element={<AdminShell event={sampleEvent} refreshEvent={refreshEvent} />}
          >
            <Route
              path="overview"
              element={<ConsumerProbe />}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "trigger refresh" }));
    expect(refreshEvent).toHaveBeenCalledTimes(1);
  });
});
