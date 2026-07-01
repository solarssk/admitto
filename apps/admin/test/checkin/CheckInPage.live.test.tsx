// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CheckInPage } from "../../src/pages/CheckInPage.js";
import type { StreamCheckinEvent } from "../../src/hooks/useEventStream.js";

const fetchCheckInHistory = vi.fn();
const fetchCheckInStats = vi.fn();
const fetchCheckInOpsConfig = vi.fn();
const fetchCheckInEvents = vi.fn();

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
  submitCheckInScan: vi.fn(),
  submitItemAction: vi.fn(),
  undoLastCheckIn: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/events/evt-live/checkin"]}>
      <Routes>
        <Route path="/admin/events/:eventId/checkin" element={<CheckInPage />} />
      </Routes>
    </MemoryRouter>,
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
    fetchCheckInOpsConfig.mockResolvedValue({
      require_confirm_on_scan: false,
      badge_at_entry: true,
      allow_manual_lookup: true,
      auto_advance_on_valid: true,
    });
    fetchCheckInEvents.mockResolvedValue([{ id: "evt-live", timezone: "UTC" }]);
    fetchCheckInHistory.mockResolvedValue([]);
    fetchCheckInStats.mockResolvedValue({ admitted_count: 2, total_count: 10 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("2")).toBeTruthy();
    });

    const event: StreamCheckinEvent = {
      type: "checkin",
      attendeeId: "att-1",
      attendeeName: "Alex Example",
      ticketType: "VIP",
      admittedAt: "2026-06-01T10:00:00.000Z",
      operatorId: null,
      deviceLabel: null,
    };

    streamHandler?.(event);
    streamHandler?.(event);

    await waitFor(() => {
      expect(screen.getByText("Alex Example")).toBeTruthy();
      expect(screen.getByText("3")).toBeTruthy();
    });
  });

  it("shows auth_error banner copy", async () => {
    streamStatus = "auth_error";
    fetchCheckInOpsConfig.mockResolvedValue({
      require_confirm_on_scan: false,
      badge_at_entry: true,
      allow_manual_lookup: true,
      auto_advance_on_valid: true,
    });
    fetchCheckInEvents.mockResolvedValue([{ id: "evt-live", timezone: "UTC" }]);
    fetchCheckInHistory.mockResolvedValue([]);
    fetchCheckInStats.mockResolvedValue({ admitted_count: 0, total_count: 0 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Live updates unavailable — check access/i)).toBeTruthy();
    });
  });
});
