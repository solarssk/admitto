// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@admitto/ui";
import { CheckInPage } from "../../src/pages/CheckInPage.js";
import type { StreamCheckinEvent } from "../../src/hooks/useEventStream.js";

const fetchCheckInHistory = vi.fn();
const fetchCheckInStats = vi.fn();
const fetchCheckInOpsConfig = vi.fn();
const fetchCheckInEvents = vi.fn();
const submitCheckInScan = vi.fn();

let streamHandler: ((event: StreamCheckinEvent) => void) | null = null;
let streamStatus: "connecting" | "connected" | "reconnecting" | "auth_error" = "connected";

vi.mock("../../src/hooks/useEventStream.js", () => ({
  useEventStream: (_eventId: string | undefined, onCheckin: (event: StreamCheckinEvent) => void) => {
    streamHandler = onCheckin;
    return { connected: streamStatus === "connected", status: streamStatus };
  },
}));

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ deviceLabel: "desk-1" }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ state: "connected", reportApiError: vi.fn() }),
}));

vi.mock("../../src/hooks/useIsDesktop.js", () => ({
  useIsDesktop: () => true,
  isDesktopViewport: () => true,
}));

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  fetchCheckInHistory: (...args: unknown[]) => fetchCheckInHistory(...args),
  fetchCheckInStats: (...args: unknown[]) => fetchCheckInStats(...args),
  fetchCheckInOpsConfig: (...args: unknown[]) => fetchCheckInOpsConfig(...args),
  fetchCheckInEvents: (...args: unknown[]) => fetchCheckInEvents(...args),
  fetchAttendeeCard: vi.fn(),
  lookupCheckInAttendees: vi.fn(),
  submitAttendeeNote: vi.fn(),
  submitCheckInAdmit: vi.fn(),
  submitCheckInScan: (...args: unknown[]) => submitCheckInScan(...args),
  submitItemAction: vi.fn(),
  undoLastCheckIn: vi.fn(),
}));

const liveEvent: StreamCheckinEvent = {
  type: "checkin",
  attendeeId: "att-1",
  attendeeName: "Alex Example",
  ticketType: "VIP",
  admittedAt: "2026-06-01T10:00:00.000Z",
  operatorId: null,
  deviceLabel: null,
};

function mockPageBootstrap(history: unknown[] = [], admitted = 2, statsAfterScan = admitted + 1) {
  fetchCheckInOpsConfig.mockResolvedValue({
    require_confirm_on_scan: false,
    badge_at_entry: true,
    allow_manual_lookup: true,
    auto_advance_on_valid: true,
  });
  fetchCheckInEvents.mockResolvedValue([{ id: "evt-live", timezone: "UTC" }]);
  fetchCheckInHistory.mockResolvedValue(history);
  fetchCheckInStats
    .mockResolvedValueOnce({ admitted_count: admitted, total_count: 10 })
    .mockResolvedValue({ admitted_count: statsAfterScan, total_count: 10 });
}

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/admin/events/evt-live/checkin"]}>
        <Routes>
          <Route path="/admin/events/:eventId/checkin" element={<CheckInPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  streamHandler = null;
  streamStatus = "connected";
});

describe("CheckInPage live feed", () => {
  it("prepends SSE check-in and deduplicates echo", async () => {
    mockPageBootstrap();

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("2")).toBeTruthy();
    });

    act(() => {
      streamHandler?.(liveEvent);
      streamHandler?.(liveEvent);
    });

    await waitFor(() => {
      expect(screen.getByText("Alex Example")).toBeTruthy();
      expect(screen.getByText("3")).toBeTruthy();
    });
  });

  it("does not double-count when history already contains the admit", async () => {
    mockPageBootstrap(
      [
        {
          id: "hist-1",
          event_id: "evt-live",
          attendee_id: "att-1",
          status: "admitted",
          checked_in_at: "2026-06-01T10:00:00.000Z",
          checked_in_by: null,
          device_id: null,
          source: null,
          attendee: { name: "Alex Example", ticket_type: "VIP" },
        },
      ],
      3,
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("3")).toBeTruthy();
    });

    act(() => {
      streamHandler?.(liveEvent);
    });

    await waitFor(() => {
      expect(screen.getByText("3")).toBeTruthy();
    });
  });

  it("deduplicates local VALID admit followed by matching SSE", async () => {
    mockPageBootstrap();
    submitCheckInScan.mockResolvedValue({
      status: "VALID",
      confirmed: true,
      admittedAt: liveEvent.admittedAt,
      attendeeId: liveEvent.attendeeId,
      card: {
        id: liveEvent.attendeeId,
        name: liveEvent.attendeeName,
        ticket_type: liveEvent.ticketType,
        company: null,
        department: null,
        check_in_status: "admitted",
      },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("QR scan or search")).toBeTruthy();
    });

    const input = screen.getByLabelText("QR scan or search");
    fireEvent.change(input, { target: { value: "QRTOKEN-ABCDEFGHIJKLMN" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(screen.getByText("Alex Example")).toBeTruthy();
      expect(screen.getByText("3")).toBeTruthy();
    });

    act(() => {
      streamHandler?.(liveEvent);
    });

    await waitFor(() => {
      expect(screen.getAllByText("Alex Example")).toHaveLength(1);
      expect(screen.getByText("3")).toBeTruthy();
    });
  });

  it("shows auth_error banner copy", async () => {
    streamStatus = "auth_error";
    mockPageBootstrap([], 0);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Live updates unavailable — check access/i)).toBeTruthy();
    });
  });

  it("sidebar refresh replaces optimistic count with authoritative server stats", async () => {
    mockPageBootstrap([], 3);
    submitCheckInScan.mockResolvedValue({
      status: "PREVIEW",
      confirmed: false,
      attendeeId: "att-2",
      card: null,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("3")).toBeTruthy();
    });

    act(() => {
      streamHandler?.(liveEvent);
    });

    await waitFor(() => {
      expect(screen.getByText("4")).toBeTruthy();
    });

    fetchCheckInStats.mockResolvedValue({ admitted_count: 2, total_count: 10 });
    fetchCheckInHistory.mockResolvedValue([]);

    const input = screen.getByLabelText("QR scan or search");
    fireEvent.change(input, { target: { value: "QRTOKEN-ABCDEFGHIJKLMN" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(screen.getByText("2")).toBeTruthy();
    });
  });
});
