// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type { RoleAssignment } from "../../src/api/types.js";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { makeOrgAdminAssignment, mockMatchMedia, renderWithToast } from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();

const ADMIN_ONE: RoleAssignment = makeOrgAdminAssignment();
const outletEvent = {
  id: "evt-1",
  title: "Demo",
  slug: "demo",
  date: "2026-06-01",
  timezone: "Europe/Warsaw",
  location: null,
  attendee_count: 1,
  wallet_enabled: true,
  wallet_apple_enabled: true,
  wallet_google_enabled: true,
  wallet_samsung_enabled: true,
  archived_at: null as string | null,
  organization_id: "org-1",
};

vi.mock("../../src/attendees/attendeeDetailForm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/attendees/attendeeDetailForm.js")>();
  return {
    ...actual,
    loadAttendeeDetailData: (...args: unknown[]) => loadAttendeeDetailData(...args),
  };
});

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [ADMIN_ONE], user: { id: "user-admin-1" } }),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useOutletContext: () => ({ event: outletEvent }) };
});

function detail() {
  return {
    id: "att-1",
    name: "Anna",
    email: "anna@example.com",
    company: null,
    department: null,
    ticket_type: "vip",
    custom_data: {},
    status: "registered" as const,
    admitted_at: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    check_in_status: "not_admitted" as const,
    last_mail_status: null,
    rsvp_status: "confirmed" as const,
    rsvp_updated_at: null,
    rsvp_source: null,
    deliveries: [],
    action_log: [],
    event_items: [],
    notes: [],
    notes_total: 0,
    notes_page: 1,
    notes_page_size: 50,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="search">{location.search}</output>;
}

function renderPage(search = "") {
  loadAttendeeDetailData.mockResolvedValueOnce({ detail: detail(), attributeFields: [], itemsWarning: null });
  renderWithToast(
    <MemoryRouter initialEntries={[`/admin/events/evt-1/attendees/att-1${search}`]}>
      <Routes>
        <Route
          path="/admin/events/:eventId/attendees/:attendeeId"
          element={
            <>
              <LocationProbe />
              <AttendeeDetailPage />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function selectedTab(name: string | RegExp) {
  return screen.getByRole("tab", { name }).getAttribute("aria-selected");
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AttendeeDetailPage - tab in the URL", () => {
  it("opens the tab named in ?tab= straight away", async () => {
    renderPage("?tab=activity");
    await screen.findByRole("heading", { name: "Anna" });

    expect(selectedTab(/Activity log/)).toBe("true");
    expect(screen.getByText("No activity yet")).toBeTruthy();
  });

  it("writes the selected tab to the URL, and keeps Overview as a clean URL", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    expect(screen.getByTestId("search").textContent).toBe("");

    fireEvent.click(screen.getByRole("tab", { name: /Notes/ }));
    expect(screen.getByTestId("search").textContent).toBe("?tab=notes");

    fireEvent.click(screen.getByRole("tab", { name: /Activity log/ }));
    expect(screen.getByTestId("search").textContent).toBe("?tab=activity");

    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByTestId("search").textContent).toBe("");
  });

  it("falls back to Overview for an unknown ?tab= value", async () => {
    renderPage("?tab=bogus");
    await screen.findByRole("heading", { name: "Anna" });

    expect(selectedTab("Overview")).toBe("true");
  });
});
