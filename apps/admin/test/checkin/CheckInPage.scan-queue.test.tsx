// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@admitto/ui";
import { CheckInPage } from "../../src/pages/CheckInPage.js";

const fetchCheckInHistory = vi.fn();
const fetchCheckInStats = vi.fn();
const fetchCheckInOpsConfig = vi.fn();
const fetchCheckInEvents = vi.fn();
const submitCheckInScan = vi.fn();
const undoLastCheckIn = vi.fn();

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
  undoLastCheckIn: (...args: unknown[]) => undoLastCheckIn(...args),
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
      admitted_at: "2026-06-01T10:00:00.000Z",
      items: [],
      notes: [],
      warnings: [],
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

describe("CheckInPage scan queue — review follow-ups (#277)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("still suppresses a duplicate scan of the same token when the first request is slower than the dedup window", async () => {
    mockPageBootstrap();
    const first = deferred<ReturnType<typeof cardResponse>>();
    submitCheckInScan.mockReturnValueOnce(first.promise);

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    fireEvent.change(input, { target: { value: "QRTOKEN-SAMEPERSON0001" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledTimes(1));

    // The SAME physical scan resubmitted only 100ms later (well inside the
    // 2500ms dedup window, CHECKIN_DUPLICATE_DEBOUNCE_MS) — while the first
    // request is still pending and won't resolve for a long time. Dedup must
    // be measured from when this second scan actually arrives, not from
    // whenever it eventually reaches the front of the queue (which, before
    // this fix, could be seconds later — long enough to appear outside the
    // dedup window even though the two physical scans were 100ms apart).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    fireEvent.change(input, { target: { value: "QRTOKEN-SAMEPERSON0001" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // The first request only resolves well after the dedup window would have
    // closed (3000ms > 2500ms) — this is what used to defeat the dedup check.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await act(async () => {
      first.resolve(cardResponse("QRTOKEN-SAMEPERSON0001", "Same Person"));
      await vi.advanceTimersByTimeAsync(200);
    });
    await vi.waitFor(() => expect(screen.getByText("Same Person")).toBeTruthy());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(submitCheckInScan).toHaveBeenCalledTimes(1);
  });

  it("clears the buffer for a queued second scan immediately, not only once it starts executing", async () => {
    mockPageBootstrap();
    const first = deferred<ReturnType<typeof cardResponse>>();
    submitCheckInScan.mockReturnValueOnce(first.promise);

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    fireEvent.change(input, { target: { value: "QRTOKEN-FIRSTPERSON01" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledTimes(1));

    // A second scan arrives and is accepted (enqueued) while the first is
    // still in flight — its buffer-clear must happen right away, not only
    // once it is dequeued, so a third scan's keystrokes never land on top of
    // this still-visible text.
    fireEvent.change(input, { target: { value: "QRTOKEN-SECONDPERSON2" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(input.value).toBe("");
    expect(submitCheckInScan).toHaveBeenCalledTimes(1); // second is still queued

    await act(async () => {
      first.resolve(cardResponse("QRTOKEN-FIRSTPERSON01", "First Person"));
      await vi.advanceTimersByTimeAsync(200);
    });
    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledTimes(2));
  });

  it("does not lose a second wedge scan when auto-advance fires for an unrelated completed scan mid-burst", async () => {
    mockPageBootstrap();
    const first = deferred<ReturnType<typeof cardResponse>>();
    const tokenA = "QRTOKEN-PERSONA00000001";
    const tokenB = "QRTOKEN-PERSONB00000002";
    submitCheckInScan
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(cardResponse(tokenB, "Person B"));

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    // Person A scanned via the length-based wedge path (no CR terminator).
    fireEvent.change(input, { target: { value: tokenA } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50); // WEDGE_DEBOUNCE_MS
    });
    expect(submitCheckInScan).toHaveBeenCalledTimes(1);

    // Operator immediately starts scanning person B — wedge injects most (not
    // all) of B's characters while A's request is still pending.
    const bPartial = tokenB.slice(0, 15);
    for (let i = 1; i <= bPartial.length; i++) {
      fireEvent.change(input, { target: { value: bPartial.slice(0, i) } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2);
      });
    }
    expect(input.value).toBe(bPartial);

    // A's slow request resolves — auto-advance must dismiss only A's card,
    // not wipe B's in-progress buffer.
    await act(async () => {
      first.resolve(cardResponse(tokenA, "Person A"));
      await vi.advanceTimersByTimeAsync(50);
    });
    await vi.waitFor(() => expect(screen.getByText("Person A")).toBeTruthy());
    expect(input.value).toBe(bPartial);

    // The wedge finishes injecting B's remaining characters.
    const bRemainder = tokenB.slice(15);
    for (let i = 1; i <= bRemainder.length; i++) {
      fireEvent.change(input, { target: { value: bPartial + bRemainder.slice(0, i) } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2);
      });
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(submitCheckInScan).toHaveBeenCalledWith("evt-live", tokenB, "desk-1");
    await vi.waitFor(() => expect(screen.getByText("Person B")).toBeTruthy());
  });

  it("queues a new scan behind an in-flight Undo instead of racing it (Codex review)", async () => {
    mockPageBootstrap();
    fetchCheckInOpsConfig.mockResolvedValue({
      require_confirm_on_scan: false,
      badge_at_entry: true,
      allow_manual_lookup: true,
      auto_advance_on_valid: false, // keep the confirmation (and Undo link) visible
    });

    const tokenA = "QRTOKEN-PERSONA00000001";
    const tokenB = "QRTOKEN-PERSONB00000002";
    submitCheckInScan
      .mockResolvedValueOnce(cardResponse(tokenA, "Person A"))
      .mockResolvedValueOnce(cardResponse(tokenB, "Person B"));
    const undo = deferred<{ card: unknown }>();
    undoLastCheckIn.mockReturnValueOnce(undo.promise);

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");
    // Ensure the ops-config fetch (auto_advance_on_valid: false) has resolved
    // and applied before scanning, or the component would still be using its
    // auto-advance-on default and dismiss the card before Undo can be clicked.
    await vi.waitFor(() => expect(fetchCheckInOpsConfig).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.change(input, { target: { value: tokenA } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await vi.advanceTimersByTimeAsync(50);
    });
    await vi.waitFor(() => expect(screen.getByText(/Undo last check-in/)).toBeTruthy());

    fireEvent.click(screen.getByText(/Undo last check-in/));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(undoLastCheckIn).toHaveBeenCalledTimes(1);

    // A new wedge scan for person B arrives while the undo request (which
    // rolls back "whichever check-in is currently latest for this device" on
    // the server, with no specific id sent) is still pending.
    fireEvent.change(input, { target: { value: tokenB } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await vi.advanceTimersByTimeAsync(50);
    });

    // Must NOT have reached the server yet — if it had, it could admit person
    // B before the undo's SELECT runs, causing undo to roll back B instead of A.
    expect(submitCheckInScan).toHaveBeenCalledTimes(1);

    await act(async () => {
      undo.resolve({ card: { id: tokenA, check_in_status: "not_admitted" } });
      await vi.advanceTimersByTimeAsync(100);
    });

    // Only now, after undo has resolved, does person B's scan run.
    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledTimes(2));
    expect(submitCheckInScan).toHaveBeenNthCalledWith(2, "evt-live", tokenB, "desk-1");
  });
});
