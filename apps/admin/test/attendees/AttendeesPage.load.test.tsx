// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import { renderWithToast } from "../test-utils.js";

const fetchEventAttendees = vi.fn();
const reportApiError = vi.fn();

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
        attendee_count: 0,
        archived_at: null,
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

describe("AttendeesPage load errors", () => {
  it("shows persistent empty state instead of an empty roster on load failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockRejectedValueOnce(new ApiError(403, "Forbidden"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Could not load attendees")).toBeTruthy();
    });
    expect(screen.getByText("You do not have access to this event.")).toBeTruthy();
    expect(screen.queryByText(/No attendees yet/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("shows a small inline retryable error next to the Type filter when only the ticket-type catalog fails, without blocking the attendee list (CodeRabbit review)", async () => {
    const { fetchTicketTypes } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));

    renderPage();

    await waitFor(() => expect(screen.getByText("Couldn't load types.")).toBeTruthy());
    // The list itself isn't replaced by an error - only the Type filter is affected.
    expect(screen.queryByText("Could not load attendees")).toBeNull();

    vi.mocked(fetchTicketTypes).mockResolvedValueOnce([
      { id: "tt-1", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 0, created_at: "2026-01-01T00:00:00.000Z" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.queryByText("Couldn't load types.")).toBeNull());
  });
});
