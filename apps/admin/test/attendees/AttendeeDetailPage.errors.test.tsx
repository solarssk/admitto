// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ApiError } from "../../src/api/client.js";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();

vi.mock("../../src/attendees/attendeeDetailForm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/attendees/attendeeDetailForm.js")>();
  return {
    ...actual,
    loadAttendeeDetailData: (...args: unknown[]) => loadAttendeeDetailData(...args),
  };
});

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [{ role: "superadmin", scope_type: "instance", scope_id: null }] }),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
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
    fetchTicketTypes: vi.fn().mockResolvedValue([]),
  };
});

import { fetchTicketTypes, updateAttendee } from "../../src/api/client.js";

const detail = {
  id: "att-1",
  name: "Anna",
  email: "anna@example.com",
  company: null,
  department: null,
  ticket_type: "vip",
  custom_data: {},
  status: "registered" as const,
  admitted_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  check_in_status: "not_admitted" as const,
  last_mail_status: null,
  rsvp_status: "confirmed" as const,
  rsvp_updated_at: null,
  rsvp_source: null,
  ticket_ref: null,
  deliveries: [],
  action_log: [],
  event_items: [],
};

function renderPage() {
  renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees/att-1"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees/:attendeeId" element={<AttendeeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AttendeeDetailPage operator errors", () => {
  it("shows the loading skeleton once the fetch has genuinely taken a moment", () => {
    loadAttendeeDetailData.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(document.querySelector(".attendee-detail-skeleton")).toBeTruthy();
  });

  it("shows load failure", async () => {
    loadAttendeeDetailData.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Failed to load attendee/)).toBeTruthy();
    });
  });

  it("shows an inline retryable error next to the Ticket type field when the catalog fails to load (CodeRabbit review)", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields: [], itemsWarning: null });
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));
    renderPage();

    await screen.findByRole("heading", { name: "Anna" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByText("Failed to load ticket types.")).toBeTruthy();

    vi.mocked(fetchTicketTypes).mockResolvedValueOnce([
      { id: "tt-1", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 1, created_at: "2026-01-01T00:00:00.000Z" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.queryByText("Failed to load ticket types.")).toBeNull());
  });
});
