// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import type { AttendeeRowDto } from "../../src/api/types.js";

const updateAttendee = vi.fn();
const fetchEventAttendees = vi.fn();
const addToast = vi.fn();

const sampleRow: AttendeeRowDto = {
  id: "att-1",
  name: "Jane Doe",
  email: "jane@example.com",
  company: "Acme",
  department: null,
  ticket_type: "VIP",
  status: "registered",
  check_in_status: "not_admitted",
  admitted_at: null,
  updated_at: "2026-06-01T10:00:00.000Z",
  last_mail_status: "sent",
  rsvp_status: "confirmed",
};

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError: vi.fn() }),
}));

vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return {
    ...actual,
    useToast: () => ({ addToast }),
  };
});

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  fetchEventAttendees: (...args: unknown[]) => fetchEventAttendees(...args),
  fetchTicketTypes: vi.fn().mockResolvedValue([]),
  exportAttendees: vi.fn(),
  bulkResendTickets: vi.fn(),
  updateAttendee: (...args: unknown[]) => updateAttendee(...args),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: {
        id: "evt-1",
        title: "Demo",
        timezone: "UTC",
        date: "2026-07-01",
        location: null,
        attendee_count: 1,
        archived_at: null,
      },
    }),
  };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees" element={<AttendeesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  addToast.mockClear();
  updateAttendee.mockReset();
  fetchEventAttendees.mockResolvedValue({
    items: [sampleRow],
    total: 1,
    page: 1,
    pageSize: 25,
  });
});

afterEach(cleanup);

describe("AttendeesPage revoke/restore", () => {
  it("confirms revoke and patches attendee status", async () => {
    updateAttendee.mockResolvedValue({
      ...sampleRow,
      status: "revoked",
      updated_at: "2026-06-01T10:01:00.000Z",
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Revoke pass" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Revoke pass" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke pass?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke pass" }));

    await waitFor(() => {
      expect(updateAttendee).toHaveBeenCalledWith("evt-1", "att-1", {
        status: "revoked",
        expected_updated_at: sampleRow.updated_at,
      });
      expect(addToast).toHaveBeenCalledWith("Pass revoked", "success");
    });
  });

  it("restores without confirm dialog and toasts event_full on capacity error", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    const revokedRow = { ...sampleRow, status: "revoked" as const };
    fetchEventAttendees.mockResolvedValue({
      items: [revokedRow],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    updateAttendee.mockRejectedValue(new ApiError(409, "event_full", "event_full"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Restore pass" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Restore pass" }));

    await waitFor(() => {
      expect(updateAttendee).toHaveBeenCalledWith("evt-1", "att-1", {
        status: "registered",
        expected_updated_at: revokedRow.updated_at,
      });
      expect(addToast).toHaveBeenCalledWith(
        "Event is at capacity — pass cannot be restored.",
        "error",
      );
    });
  });
});
