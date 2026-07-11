// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { renderWithToast } from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();
const updateAttendee = vi.fn();

vi.mock("../../src/attendees/attendeeDetailForm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/attendees/attendeeDetailForm.js")>();
  return {
    ...actual,
    loadAttendeeDetailData: (...args: unknown[]) => loadAttendeeDetailData(...args),
  };
});

let mockAssignments: Array<{ role: string; scope_type: string; scope_id: string | null }> = [
  { role: "admin", scope_type: "organization", scope_id: "org-1" },
];

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: mockAssignments }),
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
    updateAttendee: (...args: unknown[]) => updateAttendee(...args),
    resendTicket: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
    revokeAttendeeCheckIn: vi.fn(),
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
    admitted_at: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    check_in_status: "not_admitted" as const,
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
  mockAssignments = [{ role: "admin", scope_type: "organization", scope_id: "org-1" }];
});

describe("AttendeeDetailPage — Revoke pass / Restore pass (consolidated confirm-flow state)", () => {
  it("confirms Revoke pass, closes the dialog, and shows Restore pass afterward", async () => {
    mockLoad(baseDetail());
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    updateAttendee.mockResolvedValue(
      baseDetail({ status: "revoked", updated_at: "2026-01-02T00:00:00.000Z" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Revoke pass" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Revoke pass?")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke pass" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Restore pass" })).toBeTruthy();
    // The other flow's ConfirmDialog must not have opened as a side effect.
    expect(screen.queryByText("Revoke check-in?")).toBeNull();
  });

  it("shows the capacity-blocked banner (not the dialog) when Restore pass hits event_full", async () => {
    mockLoad(baseDetail({ status: "revoked" }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    const { ApiError } = await import("../../src/api/client.js");
    updateAttendee.mockRejectedValue(
      new ApiError(409, "event_full", "event_full", { current: 5, capacity: 5 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore pass" }));
    await waitFor(() => {
      expect(screen.getByText(/Event is at capacity/)).toBeTruthy();
    });
    // This is the page-level banner, not the (pass-revoke-only) ConfirmDialog.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lets a superadmin override the capacity block and retries with force: true", async () => {
    mockAssignments = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
    mockLoad(baseDetail({ status: "revoked" }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    const { ApiError } = await import("../../src/api/client.js");
    updateAttendee
      .mockRejectedValueOnce(
        new ApiError(409, "event_full", "event_full", { current: 5, capacity: 5 }),
      )
      .mockResolvedValueOnce(baseDetail({ status: "registered" }));

    fireEvent.click(screen.getByRole("button", { name: "Restore pass" }));
    await waitFor(() => {
      expect(screen.getByText(/Event is at capacity/)).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText(/Override capacity limit/));
    fireEvent.click(screen.getByRole("button", { name: "Restore pass" }));

    await waitFor(() => {
      expect(updateAttendee).toHaveBeenLastCalledWith(
        "evt-1",
        "att-1",
        expect.objectContaining({ status: "registered" }),
        { force: true },
      );
    });
  });
});
