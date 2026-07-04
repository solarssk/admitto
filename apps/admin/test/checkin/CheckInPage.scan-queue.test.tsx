// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@admitto/ui";
import { CheckInPage } from "../../src/pages/CheckInPage.js";

const fetchCheckInHistory = vi.fn();
const fetchCheckInStats = vi.fn();
const fetchCheckInOpsConfig = vi.fn();
const fetchCheckInEvents = vi.fn();
const submitCheckInScan = vi.fn();

vi.mock("../../src/hooks/useEventStream.js", () => ({
  useEventStream: () => ({ connected: true, status: "connected" }),
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

/** Deferred promise — lets the test control exactly when a scan "request" resolves. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function cardResponse(token: string, name: string) {
  return {
    status: "VALID" as const,
    confirmed: true,
    admittedAt: "2026-06-01T10:00:00.000Z",
    attendeeId: token,
    card: {
      id: token,
      name,
      ticket_type: "Standard",
      company: null,
      department: null,
      check_in_status: "admitted" as const,
    },
  };
}

function mockPageBootstrap() {
  fetchCheckInOpsConfig.mockResolvedValue({
    require_confirm_on_scan: false,
    badge_at_entry: true,
    allow_manual_lookup: true,
    auto_advance_on_valid: true,
  });
  fetchCheckInEvents.mockResolvedValue([{ id: "evt-live", timezone: "UTC" }]);
  fetchCheckInHistory.mockResolvedValue([]);
  fetchCheckInStats.mockResolvedValue({ admitted_count: 0, total_count: 10 });
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
});

describe("CheckInPage scan queue (#261)", () => {
  it("keeps the scan input enabled while a scan request is in flight", async () => {
    mockPageBootstrap();
    const first = deferred<ReturnType<typeof cardResponse>>();
    submitCheckInScan.mockReturnValueOnce(first.promise);

    renderPage();

    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");
    fireEvent.change(input, { target: { value: "QRTOKEN-FIRSTPERSON01" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => expect(submitCheckInScan).toHaveBeenCalledTimes(1));
    // Root cause of #261: the input used to be disabled while busy, so a
    // keyboard-wedge scan arriving during this window was silently dropped.
    expect(input.disabled).toBe(false);

    await act(async () => {
      first.resolve(cardResponse("QRTOKEN-FIRSTPERSON01", "First Person"));
    });
    await waitFor(() => expect(screen.getByText("First Person")).toBeTruthy());
  });

  it("processes a second scan that arrives while the first is still in flight, in order", async () => {
    mockPageBootstrap();
    const first = deferred<ReturnType<typeof cardResponse>>();
    const second = deferred<ReturnType<typeof cardResponse>>();
    submitCheckInScan.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    renderPage();

    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    fireEvent.change(input, { target: { value: "QRTOKEN-FIRSTPERSON01" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await waitFor(() => expect(submitCheckInScan).toHaveBeenCalledTimes(1));

    // Second wedge scan arrives before the first request has resolved.
    fireEvent.change(input, { target: { value: "QRTOKEN-SECONDPERSON2" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // Queued, not dropped and not fired concurrently: still only one call so far.
    expect(submitCheckInScan).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(cardResponse("QRTOKEN-FIRSTPERSON01", "First Person"));
    });
    await waitFor(() => expect(screen.getByText("First Person")).toBeTruthy());

    // Now that the first finished, the queued second scan runs.
    await waitFor(() => expect(submitCheckInScan).toHaveBeenCalledTimes(2));
    expect(submitCheckInScan).toHaveBeenNthCalledWith(1, "evt-live", "QRTOKEN-FIRSTPERSON01", "desk-1");
    expect(submitCheckInScan).toHaveBeenNthCalledWith(2, "evt-live", "QRTOKEN-SECONDPERSON2", "desk-1");

    await act(async () => {
      second.resolve(cardResponse("QRTOKEN-SECONDPERSON2", "Second Person"));
    });
    await waitFor(() => expect(screen.getByText("Second Person")).toBeTruthy());
  });
});
