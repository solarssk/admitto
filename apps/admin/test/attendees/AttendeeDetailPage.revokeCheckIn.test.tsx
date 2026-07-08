// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { renderWithToast } from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();
const revokeAttendeeCheckIn = vi.fn();

vi.mock("../../src/attendees/attendeeDetailForm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/attendees/attendeeDetailForm.js")>();
  return {
    ...actual,
    loadAttendeeDetailData: (...args: unknown[]) => loadAttendeeDetailData(...args),
  };
});

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [{ role: "admin", scope_type: "organization", scope_id: "org-1" }] }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: {
        id: "evt-1",
        title: "Demo",
        slug: "demo",
        date: "2026-06-01",
        timezone: "Europe/Warsaw",
        location: null,
        attendee_count: 1,
        archived_at: null,
      },
    }),
  };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    updateAttendee: vi.fn(),
    resendTicket: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
    revokeAttendeeCheckIn: (...args: unknown[]) => revokeAttendeeCheckIn(...args),
  };
});

function baseDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "att-1",
    name: "Anna",
    email: "anna@example.com",
    company: null,
    department: null,
    ticket_type: "vip",
    custom_data: {},
    status: "registered" as const,
    admitted_at: "2026-06-01T09:44:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    check_in_status: "admitted" as const,
    last_mail_status: null,
    rsvp_status: "confirmed" as const,
    rsvp_updated_at: null,
    rsvp_source: null,
    ticket_ref: null,
    deliveries: [],
    action_log: [],
    ...overrides,
  };
}

function mockLoad(detail: ReturnType<typeof baseDetail>) {
  loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields: [], itemsWarning: null });
}

function renderPage() {
  renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees/att-1"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees/:attendeeId" element={<AttendeeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AttendeeDetailPage — Revoke check-in", () => {
  it("shows the button only for an admitted attendee", async () => {
    mockLoad(baseDetail({ check_in_status: "not_admitted", admitted_at: null }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Revoke check-in" })).toBeNull();
  });

  it("confirms, revokes, and reloads the detail", async () => {
    mockLoad(baseDetail());
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    revokeAttendeeCheckIn.mockResolvedValue({ card: { check_in_status: "not_admitted" } });
    mockLoad(baseDetail({ check_in_status: "not_admitted", admitted_at: null }));

    fireEvent.click(screen.getByRole("button", { name: "Revoke check-in" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Revoke check-in?")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke check-in" }));
    await waitFor(() => {
      expect(revokeAttendeeCheckIn).toHaveBeenCalledWith("evt-1", "att-1");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    // Reloaded detail no longer offers the action.
    expect(screen.queryByRole("button", { name: "Revoke check-in" })).toBeNull();
  });

  it("shows an inline error on failure and keeps the button available", async () => {
    mockLoad(baseDetail());
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    revokeAttendeeCheckIn.mockRejectedValue(new Error("boom"));

    fireEvent.click(screen.getByRole("button", { name: "Revoke check-in" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke check-in" }));

    await waitFor(() => {
      expect(within(dialog).getByText("Could not revoke check-in.")).toBeTruthy();
    });
  });
});
