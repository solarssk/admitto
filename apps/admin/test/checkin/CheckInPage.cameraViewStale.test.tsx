// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { CheckInPage } from "../../src/pages/CheckInPage.js";

// Captures the real onScan callback CameraOverlay wires into CameraScanner
// (the same one a real camera decode would invoke) so a scan can be
// simulated without a working ZXing/camera stack.
let capturedOnScan: ((raw: string) => void) | undefined;
vi.mock("../../src/checkin/CameraScanner.js", () => ({
  CameraScanner: (props: { onScan: (raw: string) => void }) => {
    capturedOnScan = props.onScan;
    return <div data-testid="camera-scanner" />;
  },
}));

// Mobile viewport by default — the layout the camera-off scan bar/result-card
// view (`showMobileOverlay === false`) shares with desktop is what a phone
// sees before the camera is toggled on; CameraOverlay is the mobile-only
// surface that appears once it is. Backed by a tiny external store (not a
// static return value) so the breakpoint-crossing test below can flip it
// mid-render via setDesktopMatch, the same way useIsDesktop's real
// matchMedia listener would.
let desktopMatch = false;
const desktopMatchListeners = new Set<() => void>();
function setDesktopMatch(value: boolean) {
  desktopMatch = value;
  desktopMatchListeners.forEach((listener) => listener());
}
vi.mock("../../src/hooks/useIsDesktop.js", () => ({
  useIsDesktop: () =>
    useSyncExternalStore(
      (onStoreChange) => {
        desktopMatchListeners.add(onStoreChange);
        return () => desktopMatchListeners.delete(onStoreChange);
      },
      () => desktopMatch,
    ),
  isDesktopViewport: () => desktopMatch,
}));

const fetchCheckInHistory = vi.fn();
const fetchCheckInStats = vi.fn();
const fetchCheckInOpsConfig = vi.fn();
const fetchCheckInEvents = vi.fn();
const submitCheckInScan = vi.fn();
const lookupCheckInAttendees = vi.fn();

vi.mock("../../src/hooks/useEventStream.js", () => ({
  useEventStream: () => ({ connected: true, status: "connected" }),
}));

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ deviceLabel: "desk-1", assignments: [] }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ state: "connected", reportApiError: vi.fn() }),
}));

vi.mock("../../src/api/client.js", () => ({
  fetchTicketTypes: vi.fn().mockResolvedValue([]),
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
  lookupCheckInAttendees: (...args: unknown[]) => lookupCheckInAttendees(...args),
  submitAttendeeNote: vi.fn(),
  submitCheckInAdmit: vi.fn(),
  submitCheckInScan: (...args: unknown[]) => submitCheckInScan(...args),
  submitItemAction: vi.fn(),
  undoLastCheckIn: vi.fn(),
}));

function mockPageBootstrap() {
  fetchCheckInOpsConfig.mockResolvedValue({
    require_confirm_on_scan: false,
    badge_at_entry: true,
    allow_manual_lookup: true,
    auto_advance_on_valid: true,
  });
  fetchCheckInEvents.mockResolvedValue([{ id: "evt-live", timezone: "UTC" }]);
  fetchCheckInHistory.mockResolvedValue([]);
  fetchCheckInStats.mockResolvedValue({ admitted_count: 0, total_count: 1 });
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

const admittedCard = {
  id: "att-1",
  name: "Anna Alpha",
  company: null,
  department: null,
  ticket_type: "vip",
  check_in_status: "admitted" as const,
  admitted_at: "2026-07-10T19:01:00.000Z",
  items: [],
  notes: [],
  blocked: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  desktopMatch = false;
  desktopMatchListeners.clear();
});

describe("check-in card/scanResult — mobile camera view no longer inherits stale state (PO review)", () => {
  // The operator mobile shell defaults the camera ON (isDesktopViewport()
  // false at mount — see operatorCamera's useState initializer in
  // CheckInPage.tsx), so every test here closes it first to reach the
  // scan-bar view before exercising the open/close transition itself.
  it("opening the mobile camera clears an attendee card left showing from before it was turned on", async () => {
    mockPageBootstrap();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Exit camera mode" }));

    submitCheckInScan.mockResolvedValueOnce({
      status: "ALREADY_CHECKED_IN",
      confirmed: true,
      card: admittedCard,
    });
    const input = await screen.findByLabelText("QR scan or search");
    const token = "TEST-FIXTURE-TOKEN-NOT-REAL-SECRET-000001";
    for (let i = 1; i <= token.length; i++) {
      fireEvent.change(input, { target: { value: token.slice(0, i) } });
    }
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Anna Alpha");

    fireEvent.click(screen.getByRole("button", { name: "Use camera" }));
    await screen.findByLabelText("Camera check-in");

    // The camera overlay opened fresh — it shows its own live viewfinder
    // hint, not Anna Alpha's card from before it was turned on.
    expect(screen.getByText("Point the camera at the attendee's QR")).toBeTruthy();
    expect(screen.queryByText("Anna Alpha")).toBeNull();
  });

  it("closing the mobile camera after a scan clears the card, so the scan-bar view doesn't inherit it", async () => {
    mockPageBootstrap();
    renderPage();
    await screen.findByLabelText("Camera check-in");
    await waitFor(() => expect(capturedOnScan).toBeTypeOf("function"));

    submitCheckInScan.mockResolvedValueOnce({
      status: "ALREADY_CHECKED_IN",
      confirmed: true,
      card: admittedCard,
    });
    await act(async () => {
      capturedOnScan?.("TEST-FIXTURE-TOKEN-NOT-REAL-SECRET-000002");
    });
    // The mobile result renders Anna Alpha's name in more than one place
    // (the compact result card and the full attendee-card view beneath it)
    // — assert presence via count, not a single-match query.
    await waitFor(() => expect(screen.getAllByText("Anna Alpha").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "Exit camera mode" }));

    // Back on the scan-bar view — Anna Alpha's card from the camera session
    // must not carry over; an untouched page shows the empty state.
    await waitFor(() => expect(screen.queryByLabelText("Camera check-in")).toBeNull());
    expect(screen.queryAllByText("Anna Alpha")).toHaveLength(0);
    expect(screen.getByText("Scan a QR code or search by name to begin")).toBeTruthy();
  });

  it("a desktop↔mobile breakpoint crossing while the camera stays on clears the surface it swapped away from (code review)", async () => {
    mockPageBootstrap();
    renderPage();
    // Starts on the mobile overlay (camera defaults on on mobile).
    await screen.findByLabelText("Camera check-in");
    await waitFor(() => expect(capturedOnScan).toBeTypeOf("function"));

    submitCheckInScan.mockResolvedValueOnce({
      status: "ALREADY_CHECKED_IN",
      confirmed: true,
      card: admittedCard,
    });
    await act(async () => {
      capturedOnScan?.("TEST-FIXTURE-TOKEN-NOT-REAL-SECRET-000003");
    });
    await waitFor(() => expect(screen.getAllByText("Anna Alpha").length).toBeGreaterThan(0));

    // The device crosses the desktop breakpoint (rotation/resize) while the
    // camera stays on the whole time — cameraActive never changes, only
    // which surface renders it does.
    await act(async () => {
      setDesktopMatch(true);
    });

    // Swapped from the mobile overlay to the desktop inline camera — Anna
    // Alpha's card must not carry over into a surface that never scanned
    // her.
    await waitFor(() => expect(screen.queryByLabelText("Camera check-in")).toBeNull());
    expect(document.querySelector(".ck-inline-camera")).toBeTruthy();
    expect(screen.queryAllByText("Anna Alpha")).toHaveLength(0);
  });
});
