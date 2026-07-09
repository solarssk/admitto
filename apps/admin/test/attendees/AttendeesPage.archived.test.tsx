// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import { ARCHIVED_ACTION_TOOLTIP } from "../../src/components/ArchivedGuard.js";
import { renderWithToast } from "../test-utils.js";
import type { AttendeeRowDto } from "../../src/api/types.js";

const fetchEventAttendees = vi.fn();
const reportApiError = vi.fn();

const registeredRow: AttendeeRowDto = {
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

const revokedRow: AttendeeRowDto = {
  ...registeredRow,
  id: "att-2",
  name: "John Smith",
  email: "john@example.com",
  status: "revoked",
};

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError }),
}));

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
  updateAttendee: vi.fn(),
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
        attendee_count: 2,
        archived_at: "2026-01-01T00:00:00.000Z",
      },
    }),
  };
});

function renderPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees" element={<AttendeesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AttendeesPage archived lockdown", () => {
  it("disables every mutating control with the archived tooltip, leaving read-only controls enabled", async () => {
    fetchEventAttendees.mockResolvedValue({
      items: [registeredRow, revokedRow],
      total: 2,
      page: 1,
      pageSize: 25,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    const importButton = screen.getByRole("button", { name: "Import" });
    const addButton = screen.getByRole("button", { name: "+ Add attendee" });
    const sendTicketsButton = screen.getByRole("button", { name: "Send tickets" });
    const revokeButton = screen.getByRole("button", { name: "Revoke pass" });
    const restoreButton = screen.getByRole("button", { name: "Restore pass" });

    for (const control of [importButton, addButton, sendTicketsButton, revokeButton, restoreButton]) {
      expect(control.disabled).toBe(true);
      const describedBy = control.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      const description = document.getElementById(describedBy!);
      expect(description?.textContent).toBe(ARCHIVED_ACTION_TOOLTIP);
      expect(control.closest(".at-tooltip")).toBeTruthy();
    }

    // Read-only controls stay usable on archived events.
    expect(screen.getByRole("button", { name: "Export XLSX" }).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Export CSV" }).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Export PDF" }).disabled).toBe(false);
    const viewButtons = screen.getAllByRole("button", { name: "View attendee" });
    expect(viewButtons.every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
  });
});
