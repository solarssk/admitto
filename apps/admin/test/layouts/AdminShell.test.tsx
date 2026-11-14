// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useOutletContext } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventDto, RoleAssignment } from "../../src/api/types.js";
import { AdminGuard } from "../../src/auth/RoleRouter.js";
import { AdminShell } from "../../src/layouts/AdminShell.js";
import { makeOrgAdminAssignment, makeSuperadminAssignment } from "../test-utils.js";

let mockAssignments: RoleAssignment[] = [makeSuperadminAssignment()];

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
    <ToastProvider>
      <MemoryRouter initialEntries={["/admin/events/evt-1/overview"]}>
        <Routes>
          <Route
            path="/admin/events/:eventId/*"
            element={<AdminShell event={event} refreshEvent={refreshEvent} />}
          >
            <Route path="overview" element={<div>overview page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

afterEach(() => {
  cleanup();
  mockAssignments = [makeSuperadminAssignment()];
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
    expect(screen.getByRole("link", { name: "Users & roles" })).toBeTruthy();
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
    expect(screen.getByRole("button", { name: "Post-event" })).toHaveProperty("disabled", true);
  });

  it("threads refreshEvent through to the nested route via Outlet context", () => {
    const refreshEvent = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/admin/events/evt-1/overview"]}>
          <Routes>
            <Route
              path="/admin/events/:eventId/*"
              element={<AdminShell event={sampleEvent} refreshEvent={refreshEvent} />}
            >
              <Route path="overview" element={<ConsumerProbe />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "trigger refresh" }));
    expect(refreshEvent).toHaveBeenCalledTimes(1);
  });

  it("shows the archived notice above the page of an archived event, and not for an active one", () => {
    renderShell();
    expect(screen.queryByText(/This event is archived/)).toBeNull();

    cleanup();
    renderShell({ ...sampleEvent, archived_at: "2026-07-02T06:03:00.000Z" });
    const notice = screen.getByText(/This event is archived/);
    const page = screen.getByText("overview page");
    expect(screen.getByTestId("main").contains(notice)).toBe(true);
    expect(notice.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore event" })).toBeTruthy();
  });
});

/** The event section of the app as a viewer meets it: the guard of the admin panel, then the shell with the menu. */
function renderPanel(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin" element={<AdminGuard />}>
            <Route path="events/:eventId/*" element={<AdminShell event={sampleEvent} refreshEvent={vi.fn()} />}>
              <Route path="overview" element={<div>overview page</div>} />
              <Route path="registration" element={<div>registration page</div>} />
            </Route>
          </Route>
          <Route path="/operator" element={<p>Operator home</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

const lifecycleMenu = () => within(screen.getByRole("navigation", { name: "Event lifecycle" }));

describe("AdminShell: the Registration entry of the menu", () => {
  it("is the second entry, after Overview, a link to the page with the clipboard icon", () => {
    renderShell();

    const names = lifecycleMenu().getAllByRole("link").map((link) => link.textContent);
    expect(names.slice(0, 3)).toEqual(["Overview", "Registration", "Attendees"]);
    const entry = lifecycleMenu().getByRole("link", { name: "Registration" });
    expect(entry.getAttribute("href")).toBe("/admin/events/evt-1/registration");
    expect(entry.querySelector("i")?.className).toContain("ti-clipboard-check");
    // A live entry is a link, not one of the disabled items that stand for pages that do not exist.
    expect(lifecycleMenu().queryByRole("button", { name: "Registration" })).toBeNull();
  });

  it.each([
    ["a superadmin", [makeSuperadminAssignment()]],
    ["the administrator of the event's organisation", [makeOrgAdminAssignment()]],
  ])("is there for %s, who reach the page", (_who, assignments) => {
    mockAssignments = assignments;
    renderPanel("/admin/events/evt-1/overview");

    expect(lifecycleMenu().getByRole("link", { name: "Registration" })).toBeTruthy();
  });

  it("is not there for an operator, who never gets into the panel: they are sent to the operator screen, from the Registration page too", () => {
    mockAssignments = [{ role: "operator", scope_type: "event", scope_id: "evt-1" }];
    renderPanel("/admin/events/evt-1/registration");

    expect(screen.getByText("Operator home")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Registration" })).toBeNull();
    expect(screen.queryByText("registration page")).toBeNull();
  });

  it("is marked as the page that is open on the Registration page, whichever tab is open", () => {
    renderPanel("/admin/events/evt-1/registration?tab=access");

    const entry = lifecycleMenu().getByRole("link", { name: "Registration" });
    expect(entry.getAttribute("aria-current")).toBe("page");
    expect(entry.className).toContain("nav-item--active");
    expect(lifecycleMenu().getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBeNull();
  });
});
