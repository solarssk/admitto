// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@admitto/ui";
import { CheckInPage } from "../../src/pages/CheckInPage.js";
import type { ConnectionState } from "../../src/connection/types.js";
import { connectionStateValue } from "./connectionStateMock.js";

vi.mock("../../src/checkin/CameraScanner.js", () => ({
  CameraScanner: () => <div data-testid="camera-scanner" />,
}));

const fetchCheckInHistory = vi.fn();
const fetchCheckInStats = vi.fn();
const fetchCheckInOpsConfig = vi.fn();
const fetchCheckInEvents = vi.fn();
const fetchAttendeeCard = vi.fn();
const lookupCheckInAttendees = vi.fn();
const submitItemAction = vi.fn();
const submitCheckInScan = vi.fn();

vi.mock("../../src/hooks/useEventStream.js", () => ({
  useEventStream: () => ({ connected: true, status: "connected" }),
}));

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ deviceLabel: "desk-1", assignments: [] }),
}));

const useConnectionState = vi.fn();
vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => useConnectionState(),
}));

function mockConnectionState(state: ConnectionState) {
  useConnectionState.mockReturnValue(connectionStateValue(state));
}

// Mutable viewport so a single file can exercise both the desktop card path
// (B2) and the mobile overlay path (B3).
const viewport = vi.hoisted(() => ({ desktop: true }));
vi.mock("../../src/hooks/useIsDesktop.js", () => ({
  useIsDesktop: () => viewport.desktop,
  isDesktopViewport: () => viewport.desktop,
}));

vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return { ...actual, useToast: () => ({ addToast: vi.fn() }) };
});

vi.mock("../../src/api/client.js", () => ({
  fetchTicketTypes: vi.fn().mockResolvedValue([]),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  fetchCheckInHistory: (...a: unknown[]) => fetchCheckInHistory(...a),
  fetchCheckInStats: (...a: unknown[]) => fetchCheckInStats(...a),
  fetchCheckInOpsConfig: (...a: unknown[]) => fetchCheckInOpsConfig(...a),
  fetchCheckInEvents: (...a: unknown[]) => fetchCheckInEvents(...a),
  fetchAttendeeCard: (...a: unknown[]) => fetchAttendeeCard(...a),
  lookupCheckInAttendees: (...a: unknown[]) => lookupCheckInAttendees(...a),
  submitItemAction: (...a: unknown[]) => submitItemAction(...a),
  submitCheckInScan: (...a: unknown[]) => submitCheckInScan(...a),
  submitAttendeeNote: vi.fn(),
  submitCheckInAdmit: vi.fn(),
  undoLastCheckIn: vi.fn(),
  revokeAttendeeCheckIn: vi.fn(),
  revokeItemState: vi.fn(),
}));

/** One change event per character, mimicking a keyboard-wedge burst. */
function typeWedge(input: HTMLInputElement, token: string) {
  for (let i = 1; i <= token.length; i++) {
    fireEvent.change(input, { target: { value: token.slice(0, i) } });
  }
}

function mockPageBootstrap() {
  fetchCheckInOpsConfig.mockResolvedValue({
    require_confirm_on_scan: false,
    badge_at_entry: true,
    allow_manual_lookup: true,
    auto_advance_on_valid: false,
  });
  fetchCheckInEvents.mockResolvedValue([{ id: "evt-live", timezone: "UTC" }]);
  fetchCheckInHistory.mockResolvedValue([]);
  fetchCheckInStats.mockResolvedValue({ admitted_count: 0, total_count: 1 });
}

function pageTree() {
  return (
    <ToastProvider>
      <MemoryRouter initialEntries={["/admin/events/evt-live/checkin"]}>
        <Routes>
          <Route path="/admin/events/:eventId/checkin" element={<CheckInPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

function renderPage() {
  return render(pageTree());
}

const annaHit = {
  id: "att-1",
  name: "Anna Alpha",
  ticket_type: "vip",
  company: "Acme",
  department: null,
  check_in_status: "admitted" as const,
};

const cardWithItem = {
  id: "att-1",
  name: "Anna Alpha",
  company: null,
  department: null,
  ticket_type: "vip",
  check_in_status: "admitted" as const,
  admitted_at: "2026-09-01T09:44:00.000Z",
  items: [{ key: "badge", label: "Badge", icon: null, state: "pending", actions: ["issued"] }],
  notes: [],
  blocked: false,
};

beforeEach(() => {
  mockConnectionState("connected");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  viewport.desktop = true;
});

describe("CheckInPage — transport error banner lifecycle", () => {
  async function openCardWithItem() {
    mockPageBootstrap();
    lookupCheckInAttendees.mockResolvedValue([annaHit]);
    fetchAttendeeCard.mockResolvedValue(cardWithItem);

    const rendered = renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");
    fireEvent.change(input, { target: { value: "anna" } });
    await screen.findByText("Anna Alpha");
    fireEvent.click(screen.getByText("Anna Alpha"));
    await screen.findByRole("button", { name: "Mark badge issued" });
    return rendered;
  }

  it("clears a stale 'Request failed' banner once a retried item action succeeds (B2)", async () => {
    await openCardWithItem();
    submitItemAction
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        state: "issued",
        card: { ...cardWithItem, items: [{ ...cardWithItem.items[0], state: "issued", actions: [] }] },
      });

    // First attempt fails → the page-level transport-error alert appears.
    fireEvent.click(screen.getByRole("button", { name: "Mark badge issued" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Request failed. Try again."),
    );

    // The button re-enables (guard cleared) and the retry now succeeds —
    // the stale banner must clear, not sit over the successful outcome.
    fireEvent.click(screen.getByRole("button", { name: "Mark badge issued" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("does not render the page-level transport-error while the mobile overlay is open (B3)", async () => {
    viewport.desktop = false;
    mockPageBootstrap();
    submitCheckInScan.mockRejectedValue(new Error("boom"));

    renderPage();
    // Mobile operator shell auto-opens the camera overlay.
    await waitFor(() => expect(document.querySelector(".ck-overlay")).not.toBeNull());

    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");
    const token = "QRTOKEN-FAILINGSCAN01";
    typeWedge(input, token);
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(document.querySelector(".ck-overlay__transport-error")?.textContent).toBe(
        "Request failed. Try again.",
      ),
    );
    // Exactly one alert with this message (the overlay's) — the CheckInPage
    // paragraph is suppressed while the overlay covers it, so a screen reader
    // doesn't announce the identical error twice.
    const alerts = screen
      .getAllByRole("alert")
      .filter((el) => el.textContent === "Request failed. Try again.");
    expect(alerts).toHaveLength(1);
    expect(document.querySelector(".checkin-surface__transport-error")).toBeNull();
  });

  it("clears a stale mobile-overlay manual-search error once the connection recovers (review finding)", async () => {
    viewport.desktop = false;
    mockPageBootstrap();
    // A deferred promise: the request is sent while connected (so it isn't
    // blocked by canAct), then the connection drops before it settles —
    // canActRef (not the frozen useCallback closure) is what lets the catch
    // block see that drop.
    let rejectLookup!: (err: unknown) => void;
    lookupCheckInAttendees.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectLookup = reject;
      }),
    );

    const { rerender } = renderPage();
    await waitFor(() => expect(document.querySelector(".ck-overlay")).not.toBeNull());

    fireEvent.click(screen.getByText("Manual search"));
    const input = screen.getByLabelText("Search by name or email");
    fireEvent.change(input, { target: { value: "anna" } });
    fireEvent.keyDown(input, { key: "Enter" });

    mockConnectionState("server_unavailable");
    rerender(pageTree());
    await act(async () => {
      rejectLookup(new Error("boom"));
    });

    await waitFor(() =>
      expect(document.querySelector("#ck-overlay-manual-error")?.textContent).toBe(
        "Request failed. Try again.",
      ),
    );

    mockConnectionState("connected");
    rerender(pageTree());

    await waitFor(() => expect(document.querySelector("#ck-overlay-manual-error")).toBeNull());
  });

  it("shows the mapped API error message in the mobile overlay when a search submit is rejected by the server", async () => {
    viewport.desktop = false;
    mockPageBootstrap();
    const { ApiError } = await import("../../src/api/client.js");
    lookupCheckInAttendees.mockRejectedValueOnce(new ApiError(409, "not_admitted", "not_admitted"));

    renderPage();
    await waitFor(() => expect(document.querySelector(".ck-overlay")).not.toBeNull());

    fireEvent.click(screen.getByText("Manual search"));
    const input = screen.getByLabelText("Search by name or email");
    fireEvent.change(input, { target: { value: "anna" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(document.querySelector("#ck-overlay-manual-error")?.textContent).toBe(
        "This attendee isn't currently checked in.",
      ),
    );
  });

  it("clears a stale transport-error once the connection recovers, without a retry (#458)", async () => {
    // openLookupResultImpl (Recent-scans row click) isn't gated on canAct
    // — unlike the scan bar's suggestion fetch — so it can fail while
    // disconnected, reproducing the #458 repro (backend restart, then click
    // a Recent-scans row before the connection recovers).
    mockConnectionState("server_unavailable");
    mockPageBootstrap();
    fetchCheckInHistory.mockResolvedValue([
      {
        id: "hist-1",
        event_id: "evt-live",
        attendee_id: "att-1",
        status: "admitted",
        checked_in_at: "2026-06-01T10:00:00.000Z",
        checked_in_by: null,
        device_id: null,
        source: null,
        attendee: { name: "Anna Alpha", ticket_type: "vip" },
      },
    ]);
    fetchAttendeeCard.mockRejectedValueOnce(new Error("boom"));

    const { rerender } = renderPage();
    await screen.findByText("Anna Alpha");
    fireEvent.click(screen.getByText("Anna Alpha"));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Request failed. Try again."),
    );

    // Connection recovers in the background — no retry click from the operator.
    mockConnectionState("connected");
    rerender(pageTree());

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("does not clear a business-logic transport-error through an unrelated reconnect blip (review finding)", async () => {
    // The reconnect-clear effect only fires for a message caught while the
    // heartbeat looked down; an error caught while genuinely connected must
    // survive a later, unrelated connectivity hiccup — only the operator's
    // own retry should dismiss it.
    const { rerender } = await openCardWithItem();
    submitItemAction.mockRejectedValueOnce(new Error("boom"));

    fireEvent.click(screen.getByRole("button", { name: "Mark badge issued" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Request failed. Try again."),
    );

    mockConnectionState("reconnecting");
    rerender(pageTree());
    mockConnectionState("connected");
    rerender(pageTree());

    expect(screen.getByRole("alert").textContent).toBe("Request failed. Try again.");
  });

  it("clears a stale transport-error once a different lookup succeeds, not just on reconnect (review finding)", async () => {
    mockPageBootstrap();
    lookupCheckInAttendees.mockResolvedValue([annaHit]);
    fetchAttendeeCard.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(cardWithItem);
    fetchCheckInHistory.mockResolvedValue([
      {
        id: "hist-1",
        event_id: "evt-live",
        attendee_id: "att-1",
        status: "admitted",
        checked_in_at: "2026-09-01T09:44:00.000Z",
        checked_in_by: null,
        device_id: null,
        source: null,
        attendee: { name: "Anna Alpha", ticket_type: "vip" },
      },
    ]);

    renderPage();
    await screen.findByText("Anna Alpha");
    fireEvent.click(screen.getByText("Anna Alpha"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Request failed. Try again."),
    );

    // A second, successful lookup (not a retry of the same one) must also
    // clear the stale banner — openLookupResultImpl didn't clear it at the
    // start of its own attempt, unlike every other mutation handler.
    fireEvent.click(screen.getByText("Anna Alpha"));
    await screen.findByRole("button", { name: "Mark badge issued" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
