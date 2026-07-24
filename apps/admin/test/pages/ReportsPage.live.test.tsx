// @vitest-environment jsdom
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
      fetchEventReports.mockResolvedValueOnce(reportFixture(5)).mockResolvedValue(reportFixture(6));
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

      // The debounced reconcile fetch replaces the optimistic guess with the server's real count.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      await waitFor(() => {
        expect(fetchEventReports).toHaveBeenCalledTimes(2);
        expect(admittedValue()).toBe("6");
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
});
