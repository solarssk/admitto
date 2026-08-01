// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";
import type { AttendeeRowDto } from "../../src/api/types.js";

const fetchEventAttendees = vi.fn();
const reportApiError = vi.fn();

function makeRow(id: string, name: string): AttendeeRowDto {
  return {
    id,
    name,
    email: `${id}@example.com`,
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
}

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
  fetchEventItems: vi.fn().mockResolvedValue([]),
  fetchEventTemplates: vi.fn().mockResolvedValue([]),
  fetchEventMailSettings: vi.fn().mockResolvedValue({
    eventId: "evt-1",
    organizationId: "org-1",
    isProduction: false,
    hasEventOverride: false,
    fields: { provider: { value: "smtp", source: "organization", locked: false } },
  }),
  exportAttendees: vi.fn(),
  bulkResendTickets: vi.fn(),
  sendEventBulk: vi.fn(),
  updateAttendee: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: {
        id: "evt-1",
        title: "Demo",
        timezone: "UTC",
        date: "2026-07-01",
        location: null,
        attendee_count: 60,
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

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AttendeesPage search debounce", () => {
  it("debounces the search box before refetching with the trimmed term", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });

    renderPage();
    await screen.findByText(/No attendees yet/i);

    fireEvent.change(screen.getByLabelText("Search attendees by name, email, or company"), {
      target: { value: "jane" },
    });

    // Past DEBOUNCE_MS (300ms).
    await new Promise((r) => setTimeout(r, 400));

    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ q: "jane" }),
        expect.anything(),
      );
    });
  });

  it("does not reset to page 1 when the debounce timer fires with an unchanged search value while paginated", async () => {
    fetchEventAttendees.mockResolvedValue({
      items: [makeRow("att-1", "Jane Doe")],
      // > pageSize (25) so a second (and third) page exist to navigate to.
      total: 60,
      page: 1,
      pageSize: 25,
    });

    // Fake timers under full manual control (no shouldAdvanceTime) so the mount-scheduled
    // debounce timer cannot fire until explicitly advanced below. With a real (or
    // auto-advancing) clock, a slow/contended test worker could let this test's own initial
    // `waitFor`/`findByText` eat past DEBOUNCE_MS, so the timer fires while page is still 1
    // (harmless) and *before* the Next click below - the pre-fix code would then pass this
    // test too, a false negative (bot review finding on #675).
    vi.useFakeTimers();
    try {
      renderPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("Jane Doe")).toBeTruthy();
      expect(fetchEventAttendees).toHaveBeenCalledTimes(1);

      // Paginate away from page 1 - still before the mount-scheduled debounce timer has been
      // allowed to fire, since the search box was never touched (starts and stays empty).
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchEventAttendees).toHaveBeenCalledTimes(2);
      expect(fetchEventAttendees).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 2 }),
        expect.anything(),
      );
      expect(screen.getByText("Page 2 of 3")).toBeTruthy();

      // Only now let the mount-scheduled timer (DEBOUNCE_MS = 300) actually fire,
      // deterministically after pagination - this is what exercises the regression. The
      // buggy version calls setPage(1) unconditionally here (the debounced value never
      // actually changed), triggering an unplanned 3rd fetch for page 1 and silently
      // snapping the operator back to it.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      expect(fetchEventAttendees).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
