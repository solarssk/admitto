// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from "react-router";
import { ReportsPage } from "../../src/pages/ReportsPage.js";
import type { EventReportsResponse } from "../../src/api/types.js";
import type { StreamCheckinEvent } from "../../src/hooks/useEventStream.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";

const fetchEventReports = vi.fn();
const fetchTicketTypes = vi.fn();
const reportApiError = vi.fn();

let streamHandler: ((event: StreamCheckinEvent) => void) | null = null;

vi.mock("../../src/hooks/useEventStream.js", () => ({
  useEventStream: (_eventId: string, onCheckin: (event: StreamCheckinEvent) => void) => {
    streamHandler = onCheckin;
    return { connected: true, status: "connected" };
  },
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ state: "connected", reportApiError }),
}));

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  fetchEventReports: (...args: unknown[]) => fetchEventReports(...args),
  fetchTicketTypes: (...args: unknown[]) => fetchTicketTypes(...args),
  exportEventReportsCsv: vi.fn(),
  eventReportsPrintUrl: (eventId: string) => `/api/admin/events/${eventId}/reports/export?format=pdf`,
}));

function reportFixture(
  admitted = 5,
  overrides: Partial<EventReportsResponse> = {},
): EventReportsResponse {
  return {
    timezone: "UTC",
    event: { id: "evt-1", title: "Demo Event", date: "2026-07-01T18:00:00.000Z", capacity: 100 },
    summary: {
      total_attendees: 10,
      admitted,
      no_shows: 10 - admitted,
      admission_rate_pct: Math.round((admitted / 10) * 1000) / 10,
      peak_hour: "14:00",
      peak_hour_count: admitted,
    },
    by_hour: [],
    by_ticket_type: [],
    admission_log: [],
    admission_log_truncated: false,
    admission_log_total: 0,
    by_rsvp_status: [],
    by_checkin_method: [],
    by_device: [],
    ...overrides,
  };
}

const liveEvent: StreamCheckinEvent = {
  type: "checkin",
  attendeeId: "att-9",
  attendeeName: "Sam Guest",
  ticketType: null,
  admittedAt: "2026-06-01T11:00:00.000Z",
  operatorId: null,
  deviceLabel: null,
};

function renderPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/reports"]}>
      <Routes>
        <Route path="/admin/events/:eventId/reports" element={<ReportsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function admittedValue(): string {
  const labels = Array.from(document.querySelectorAll(".reports-stat__label"));
  const admittedLabel = labels.find((el) => el.textContent === "Admitted");
  const value = admittedLabel?.closest(".reports-stat")?.querySelector(".reports-stat__value");
  return value?.textContent ?? "";
}

function noShowsValue(): string {
  const labels = Array.from(document.querySelectorAll(".reports-stat__label"));
  const label = labels.find((el) => el.textContent === "No-shows");
  const value = label?.closest(".reports-stat")?.querySelector(".reports-stat__value");
  return value?.textContent ?? "";
}

beforeEach(() => {
  fetchTicketTypes.mockResolvedValue([]);
  // ReportsPage's AdmissionLog now picks a table (desktop) or card list (mobile) via
  // useIsDesktop(), which reads window.matchMedia - jsdom doesn't implement it. Defaults to
  // desktop so existing table-shaped assertions keep working unchanged.
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  streamHandler = null;
});

describe("ReportsPage — live SSE updates (ADR 0014)", () => {
  it("always renders the live badge next to the hourly chart", async () => {
    fetchEventReports.mockResolvedValue(reportFixture(5));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("live")).toBeTruthy();
    });
  });

  it("bumps Admitted/No-shows optimistically on a live check-in, then reconciles from the server", async () => {
    // Fake timers so the 3s reconcile debounce doesn't depend on real wall-clock time - a
    // real-timer version of this test was flaky under the full suite's parallel load (passed
    // reliably alone, occasionally missed its window with 160+ other files running).
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // The reconciled fixture (7) is deliberately different from the optimistic bump's result
      // (5+1=6) - representing the server having observed more admissions than this client's own
      // SSE delivery did - so the final assertion can only pass if the reconcile fetch's data
      // actually replaced the optimistic guess, not merely if the guess happened to match.
      fetchEventReports.mockResolvedValueOnce(reportFixture(5)).mockResolvedValue(reportFixture(7));
      renderPage();

      await waitFor(() => {
        expect(admittedValue()).toBe("5");
      });
      expect(noShowsValue()).toBe("5");

      act(() => {
        streamHandler?.(liveEvent);
      });

      await waitFor(() => {
        expect(admittedValue()).toBe("6");
      });
      expect(noShowsValue()).toBe("4");

      // The debounced reconcile fetch replaces the optimistic guess with the server's real count -
      // 7, not 6, proving this assertion actually observed the reconciled fetch rather than just
      // re-confirming the optimistic bump from before.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      await waitFor(() => {
        expect(fetchEventReports).toHaveBeenCalledTimes(2);
        expect(admittedValue()).toBe("7");
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("deduplicates a repeated SSE delivery of the same admit instead of double-counting it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchEventReports.mockResolvedValueOnce(reportFixture(5)).mockResolvedValue(reportFixture(6));
      renderPage();

      await waitFor(() => {
        expect(admittedValue()).toBe("5");
      });

      act(() => {
        streamHandler?.(liveEvent);
        streamHandler?.(liveEvent);
      });

      await waitFor(() => {
        expect(admittedValue()).toBe("6");
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      await waitFor(() => {
        expect(fetchEventReports).toHaveBeenCalledTimes(2);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps the admission log back to the last real page when a reconcile shrinks it out from under a page 2+ view", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const bigLog = Array.from({ length: 51 }, (_, i) => ({
        attendee_id: `att-${i + 1}`,
        name: `Guest ${i + 1}`,
        email: `guest-${i + 1}@example.com`,
        ticket_type: null,
        admitted_at: "2026-06-01T10:00:00.000Z",
        device_id: null,
        items: [],
      }));
      const smallLog = bigLog.slice(0, 3);
      fetchEventReports
        .mockResolvedValueOnce(reportFixture(51, { admission_log: bigLog, admission_log_total: 51 }))
        .mockResolvedValue(reportFixture(3, { admission_log: smallLog, admission_log_total: 3 }));
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Guest 1")).toBeTruthy();
      });
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await waitFor(() => {
        expect(screen.getByText("Guest 51")).toBeTruthy();
      });

      act(() => {
        streamHandler?.(liveEvent);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      // The reconciled data only has 3 rows (1 page) - page 2 no longer exists. Without the
      // clamp this would slice past the end and show the empty-filter message despite Guest 1
      // still being right there on the only page that does exist.
      await waitFor(() => {
        expect(fetchEventReports).toHaveBeenCalledTimes(2);
        expect(screen.getByText("Guest 1")).toBeTruthy();
      });
      expect(screen.queryByText("No admissions match the filter.")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending reconcile timer when the viewed event changes, instead of letting it fire against the old event later (#587 review)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchEventReports.mockImplementation(async (eventId: string) =>
        reportFixture(5, {
          event: { id: eventId, title: "Demo Event", date: "2026-07-01T18:00:00.000Z", capacity: 100 },
        }),
      );
      // createMemoryRouter + RouterProvider (not the plain <MemoryRouter> renderPage() uses), so
      // router.navigate() can change the :eventId param in place without remounting ReportsPage -
      // the same in-SPA navigation the bug this guards against actually happens on.
      const router = createMemoryRouter(
        [{ path: "/admin/events/:eventId/reports", element: <ReportsPage /> }],
        { initialEntries: ["/admin/events/evt-a/reports"] },
      );
      renderWithToast(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(fetchEventReports).toHaveBeenCalledWith("evt-a", expect.anything());
      });

      // Arms a 3s reconcile timer scoped to evt-a.
      act(() => {
        streamHandler?.(liveEvent);
      });

      await router.navigate("/admin/events/evt-b/reports");
      await waitFor(() => {
        expect(fetchEventReports).toHaveBeenCalledWith("evt-b", expect.anything());
      });
      fetchEventReports.mockClear();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      // If the evt-a timer had survived the switch, this advance would fire a stale
      // fetchEventReports("evt-a") call whose result could silently overwrite evt-b's data.
      expect(fetchEventReports).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses clear empty-state markers when an admission has no device or issued items", async () => {
    const data = reportFixture(1, {
      admission_log: [{
        attendee_id: "att-empty",
        name: "No Device Guest",
        email: "guest@example.com",
        ticket_type: null,
        admitted_at: "2026-06-01T10:00:00.000Z",
        device_id: null,
        items: [],
      }],
      admission_log_total: 1,
    });
    data.summary.peak_hour = null;
    data.summary.peak_hour_count = 0;
    fetchEventReports.mockResolvedValue(data);

    renderPage();

    await screen.findByText("No Device Guest");
    const table = document.querySelector(".reports-log-table");
    expect(table).toBeTruthy();
    expect(within(table!).getByText("No Device Guest")).toBeTruthy();
    expect(within(table!).getAllByText("-").length).toBeGreaterThanOrEqual(2);
  });
});
