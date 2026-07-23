// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@admitto/ui";
import { CheckInPage } from "../../src/pages/CheckInPage.js";

const fetchCheckInHistory = vi.fn();
const fetchCheckInStats = vi.fn();
const fetchCheckInOpsConfig = vi.fn();
const fetchCheckInEvents = vi.fn();
const submitCheckInScan = vi.fn();
const submitCheckInAdmit = vi.fn();
const undoLastCheckIn = vi.fn();
const lookupCheckInAttendees = vi.fn();
const fetchTicketTypes = vi.fn();

vi.mock("../../src/hooks/useEventStream.js", () => ({
  useEventStream: () => ({ connected: true, status: "connected" }),
}));

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ deviceLabel: "desk-1", assignments: [] }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ state: "connected", reportApiError: vi.fn() }),
}));

vi.mock("../../src/hooks/useIsDesktop.js", () => ({
  useIsDesktop: () => true,
  isDesktopViewport: () => true,
}));

vi.mock("../../src/api/client.js", () => ({
  fetchTicketTypes: (...args: unknown[]) => fetchTicketTypes(...args),
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
  submitCheckInAdmit: (...args: unknown[]) => submitCheckInAdmit(...args),
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

/**
 * Flushes pending microtasks (never advances the fake clock — real timers'
 * setTimeout-based waitFor would either hang or require a clock advance,
 * defeating tests that specifically need elapsed time to stay near zero)
 * until `predicate` is true or `maxTicks` is exhausted. Self-documenting
 * alternative to awaiting a hardcoded number of `Promise.resolve()` calls,
 * which silently breaks if the code's internal await depth ever changes.
 */
async function flushMicrotasksUntil(predicate: () => boolean, maxTicks = 50): Promise<void> {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    await Promise.resolve();
  }
}

/**
 * Simulates a keyboard-wedge character burst: fires one change event per
 * character, building the token incrementally. Optionally advances fake
 * timers between characters (gapMs) and stamps events with explicit
 * timeStamp values (baseTime + i*2ms) for tests that rely on the event
 * timestamp, not Date.now(), to detect burst speed.
 */
async function typeWedge(
  input: HTMLInputElement,
  token: string,
  opts?: { gapMs?: number; baseTime?: number; prefix?: string },
): Promise<void> {
  const { gapMs, baseTime, prefix = "" } = opts ?? {};
  for (let i = 1; i <= token.length; i++) {
    const value = prefix + token.slice(0, i);
    if (baseTime !== undefined) {
      const event = createEvent.change(input, { target: { value } });
      Object.defineProperty(event, "timeStamp", { value: baseTime + i * 2, configurable: true });
      fireEvent(input, event);
    } else {
      fireEvent.change(input, { target: { value } });
    }
    if (gapMs !== undefined) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(gapMs);
      });
    }
  }
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
      blocked: false,
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
  fetchTicketTypes.mockResolvedValue([]);
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
  // resetAllMocks (not clearAllMocks): also drops any queued
  // mockResolvedValueOnce/mockReturnValueOnce left unconsumed by a test whose
  // scan/lookup didn't actually fire, so it can't leak into the next test.
  vi.resetAllMocks();
});

describe("CheckInPage scan queue (#261)", () => {
  it("keeps the scan input enabled while a scan request is in flight", async () => {
    mockPageBootstrap();
    const first = deferred<ReturnType<typeof cardResponse>>();
    submitCheckInScan.mockReturnValueOnce(first.promise);

    renderPage();

    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");
    const tokenFirst = "QRTOKEN-FIRSTPERSON01";
    await typeWedge(input, tokenFirst);
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(submitCheckInScan).toHaveBeenCalledTimes(1));
    // Root cause of #261: the input used to be disabled while busy, so a
    // keyboard-wedge scan arriving during this window was silently dropped.
    expect(input.disabled).toBe(false);

    await act(async () => {
      first.resolve(cardResponse("QRTOKEN-FIRSTPERSON01", "First Person"));
    });
    await screen.findByText("First Person");
  });

  it("processes a second scan that arrives while the first is still in flight, in order", async () => {
    mockPageBootstrap();
    const first = deferred<ReturnType<typeof cardResponse>>();
    const second = deferred<ReturnType<typeof cardResponse>>();
    submitCheckInScan.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    renderPage();

    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    const tokenFirst = "QRTOKEN-FIRSTPERSON01";
    await typeWedge(input, tokenFirst);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(submitCheckInScan).toHaveBeenCalledTimes(1));

    // Second wedge scan arrives before the first request has resolved.
    const tokenSecond = "QRTOKEN-SECONDPERSON2";
    await typeWedge(input, tokenSecond);
    fireEvent.keyDown(input, { key: "Enter" });

    // Queued, not dropped and not fired concurrently: still only one call so far.
    expect(submitCheckInScan).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(cardResponse("QRTOKEN-FIRSTPERSON01", "First Person"));
    });
    await screen.findByText("First Person");

    // Now that the first finished, the queued second scan runs.
    await waitFor(() => expect(submitCheckInScan).toHaveBeenCalledTimes(2));
    expect(submitCheckInScan).toHaveBeenNthCalledWith(1, "evt-live", "QRTOKEN-FIRSTPERSON01", "desk-1");
    expect(submitCheckInScan).toHaveBeenNthCalledWith(2, "evt-live", "QRTOKEN-SECONDPERSON2", "desk-1");

    await act(async () => {
      second.resolve(cardResponse("QRTOKEN-SECONDPERSON2", "Second Person"));
    });
    await screen.findByText("Second Person");
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

    const sameToken = "QRTOKEN-SAMEPERSON0001";
    await typeWedge(input, sameToken, { gapMs: 2 });
    fireEvent.keyDown(input, { key: "Enter" });
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
    await typeWedge(input, sameToken, { gapMs: 2 });
    fireEvent.keyDown(input, { key: "Enter" });

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

    const tokenFirst = "QRTOKEN-FIRSTPERSON01";
    await typeWedge(input, tokenFirst, { gapMs: 2 });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledTimes(1));

    // A second scan arrives and is accepted (enqueued) while the first is
    // still in flight — its buffer-clear must happen right away, not only
    // once it is dequeued, so a third scan's keystrokes never land on top of
    // this still-visible text.
    const tokenSecond = "QRTOKEN-SECONDPERSON2";
    await typeWedge(input, tokenSecond, { gapMs: 2 });
    fireEvent.keyDown(input, { key: "Enter" });

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
    await typeWedge(input, tokenA, { gapMs: 2 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50); // WEDGE_DEBOUNCE_MS
    });
    expect(submitCheckInScan).toHaveBeenCalledTimes(1);

    // Operator immediately starts scanning person B — wedge injects most (not
    // all) of B's characters while A's request is still pending.
    const bPartial = tokenB.slice(0, 15);
    await typeWedge(input, bPartial, { gapMs: 2 });
    expect(input.value).toBe(bPartial);

    // Capture performance.now() immediately after the last bPartial character.
    // With shouldAdvanceTime:true, real time elapsed inside the act() below
    // advances the fake clock (and thus event.timeStamp) by an unpredictable
    // amount. Pinning bRemainder events to this timestamp keeps inter-character
    // gaps well below WEDGE_MAX_INTER_KEY_GAP_MS (30ms) on any machine speed.
    const lastBurstTime = performance.now();

    // A's slow request resolves — auto-advance must dismiss only A's card,
    // not wipe B's in-progress buffer. Flushed via microtasks only (no fake-
    // clock advance) so the elapsed time since B's last keystroke stays near
    // zero — a real wedge scan is a single uninterrupted physical burst; it
    // is not paused by an unrelated server response arriving mid-scan.
    await act(async () => {
      first.resolve(cardResponse(tokenA, "Person A"));
      await flushMicrotasksUntil(() => screen.queryByText("Person A") !== null);
    });
    expect(screen.getByText("Person A")).toBeTruthy();
    expect(input.value).toBe(bPartial);

    // The wedge finishes injecting B's remaining characters. Each event is
    // stamped relative to lastBurstTime so the burst window is maintained
    // regardless of how much real time elapsed during the act() above.
    const bRemainder = tokenB.slice(15);
    await typeWedge(input, bRemainder, { gapMs: 2, baseTime: lastBurstTime, prefix: bPartial });
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

    await typeWedge(input, tokenA, { gapMs: 2 });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await vi.advanceTimersByTimeAsync(50);
    });
    await vi.waitFor(() => expect(screen.getByText(/Undo check-in/)).toBeTruthy());

    fireEvent.click(screen.getByText(/Undo check-in/));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(undoLastCheckIn).toHaveBeenCalledTimes(1);

    // A new wedge scan for person B arrives while the undo request (which
    // rolls back "whichever check-in is currently latest for this device" on
    // the server, with no specific id sent) is still pending.
    await typeWedge(input, tokenB, { gapMs: 2 });
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

  it("does not let a slow Confirm check-in response overwrite a scan that arrived after it (Codex review)", async () => {
    mockPageBootstrap();
    fetchCheckInOpsConfig.mockResolvedValue({
      require_confirm_on_scan: true,
      badge_at_entry: true,
      allow_manual_lookup: true,
      auto_advance_on_valid: false, // keep B's card visible instead of auto-dismissing
    });
    const tokenA = "QRTOKEN-PERSONA00000001";
    const tokenB = "QRTOKEN-PERSONB00000002";

    submitCheckInScan
      .mockResolvedValueOnce({
        status: "PREVIEW",
        confirmed: false,
        attendeeId: tokenA,
        card: {
          id: tokenA,
          name: "Person A",
          ticket_type: "Standard",
          company: null,
          department: null,
          check_in_status: "not_admitted" as const,
          admitted_at: null,
          items: [],
          notes: [],
          blocked: false,
        },
      })
      .mockResolvedValueOnce(cardResponse(tokenB, "Person B"));
    const confirm = deferred<{ status: "VALID"; confirmed: true; admittedAt: string; card: unknown }>();
    submitCheckInAdmit.mockReturnValueOnce(confirm.promise);

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");
    await vi.waitFor(() => expect(fetchCheckInOpsConfig).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Person A scans and requires explicit confirmation (not auto-admitted).
    await typeWedge(input, tokenA, { gapMs: 2 });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(screen.getByText("Confirm check-in")).toBeTruthy());

    // Operator confirms A — this request is slow (deferred).
    fireEvent.click(screen.getByText("Confirm check-in"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(submitCheckInAdmit).toHaveBeenCalledTimes(1);

    // Operator immediately scans person B while A's confirm is still pending.
    await typeWedge(input, tokenB, { gapMs: 2 });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await vi.advanceTimersByTimeAsync(50);
    });

    // B's scan must not have reached the server yet — otherwise, if it
    // resolved before A's slower confirm, A's response would later overwrite
    // B's already-displayed card.
    expect(submitCheckInScan).toHaveBeenCalledTimes(1);

    await act(async () => {
      confirm.resolve({
        status: "VALID",
        confirmed: true,
        admittedAt: "2026-06-01T10:05:00.000Z",
        card: {
          id: tokenA,
          name: "Person A",
          ticket_type: "Standard",
          company: null,
          department: null,
          check_in_status: "admitted" as const,
          admitted_at: "2026-06-01T10:05:00.000Z",
          items: [],
          notes: [],
          blocked: false,
        },
      });
      await vi.advanceTimersByTimeAsync(100);
    });

    // Only now does B's scan run, and its card is what stays on screen (A
    // still appears in the sidebar's admitted-history list — that is
    // expected — but the main attendee card must show B, not be reverted
    // back to A by A's late-arriving confirm response).
    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(document.querySelector(".checkin-card__name")?.textContent).toBe("Person B"),
    );
  });

  it("does not let a wedge scan append onto a still-pending manual-lookup query (Codex review)", async () => {
    mockPageBootstrap();
    const lookup = deferred<Awaited<ReturnType<typeof lookupCheckInAttendees>>>();
    lookupCheckInAttendees.mockReturnValueOnce(lookup.promise);
    const scanToken = "QRTOKEN-REALPERSON0001"; // 22 chars
    submitCheckInScan.mockResolvedValueOnce(cardResponse(scanToken, "Real Person"));

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    // Operator types a short manual query and submits it (< 20 chars, takes
    // the lookup branch, not the scan branch).
    fireEvent.change(input, { target: { value: "Alice" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(lookupCheckInAttendees).toHaveBeenCalledWith("evt-live", "Alice"));

    // The buffer must already be empty at this point — cleared the moment
    // the lookup was accepted, not only once it resolves — so a wedge scan
    // arriving now cannot get appended after "Alice".
    expect(input.value).toBe("");

    // A keyboard-wedge scan now injects a real token while the lookup for
    // "Alice" is still pending.
    await typeWedge(input, scanToken, { gapMs: 2 });
    expect(input.value).toBe(scanToken); // not "Alice" + scanToken
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50); // WEDGE_DEBOUNCE_MS
    });

    await act(async () => {
      lookup.resolve([]);
      await vi.advanceTimersByTimeAsync(100);
    });

    // The clean token was submitted as its own scan, unmodified by "Alice".
    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledWith("evt-live", scanToken, "desk-1"));
    await vi.waitFor(() => expect(screen.getByText("Real Person")).toBeTruthy());
  });
});

describe("CheckInPage scan queue — #262/bot review (Enter/paste routing)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes a slowly-typed long email to lookup on Enter, after a scan attempt comes back no-match", async () => {
    mockPageBootstrap();
    submitCheckInScan.mockResolvedValueOnce({ status: "INVALID", confirmed: false });
    lookupCheckInAttendees.mockResolvedValueOnce([]);

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    // A plausible operator workflow: typing an email copied by hand, one
    // character at a time, well under burst speed (60ms > WEDGE_MAX_INTER_KEY_GAP_MS).
    const query = "someone.long-name@international-trade-fair.example.com";
    await typeWedge(input, query, { gapMs: 60 });
    // The debounce timer must not have auto-submitted this while still typing
    // — only the explicit Enter below decides anything for non-burst input.
    expect(submitCheckInScan).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });

    // An explicit Enter on a value this long always tries a scan attempt
    // first (round 6 — the server's resolver recognizes every valid code
    // shape, including formats a client-side heuristic can't, e.g. a ticket
    // URL or an agency-issued QR payload/UUID; earlier rounds tried to guess
    // "is this a code" client-side instead, which was never complete).
    // Since this isn't a real code, it falls back to a name/email lookup.
    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledWith("evt-live", query, "desk-1"));
    await vi.waitFor(() => expect(lookupCheckInAttendees).toHaveBeenCalledWith("evt-live", query));
  });

  it("routes a pasted long email to lookup on Enter, after a scan attempt comes back no-match", async () => {
    mockPageBootstrap();
    submitCheckInScan.mockResolvedValueOnce({ status: "INVALID", confirmed: false });
    lookupCheckInAttendees.mockResolvedValueOnce([]);

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    // A paste delivers the whole value in one change event, with no prior
    // keystroke to compare timing against — the same shape as autofill,
    // swipe-to-type, or voice dictation.
    const pasted = "someone.long-name@international-trade-fair.example.com";
    fireEvent.paste(input);
    fireEvent.change(input, { target: { value: pasted } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50); // WEDGE_DEBOUNCE_MS
    });
    expect(submitCheckInScan).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledWith("evt-live", pasted, "desk-1"));
    await vi.waitFor(() => expect(lookupCheckInAttendees).toHaveBeenCalledWith("evt-live", pasted));
  });

  it("routes a slowly-typed long token to a successful scan attempt on Enter, no lookup fallback needed", async () => {
    mockPageBootstrap();
    const query = "TEST-FIXTURE-TOKEN-NOT-REAL-SECRET-000001";
    submitCheckInScan.mockResolvedValueOnce(cardResponse(query, "Typed Token Person"));

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    await typeWedge(input, query, { gapMs: 60 });
    expect(submitCheckInScan).not.toHaveBeenCalled();

    // The field's own hint text ("it submits itself") is exactly what happens
    // next: an explicit Enter on a value this long is unconditionally an
    // intentional "try this now" (this used to also require proof of a
    // genuine keyboard-wedge burst, which made a real pasted/typed code fall
    // through to a doomed name/email lookup instead of the scan attempt it
    // obviously was).
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledWith("evt-live", query, "desk-1"));
    expect(lookupCheckInAttendees).not.toHaveBeenCalled();
  });

  it("routes a pasted long token to a successful scan attempt on Enter, no lookup fallback needed", async () => {
    mockPageBootstrap();
    const pasted = "TEST-FIXTURE-TOKEN-NOT-REAL-SECRET-000001";
    submitCheckInScan.mockResolvedValueOnce(cardResponse(pasted, "Pasted Token Person"));

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    fireEvent.paste(input);
    fireEvent.change(input, { target: { value: pasted } });

    // The silent, no-Enter auto-submit timer must still never fire for
    // pasted text — that path has no user confirmation at all, so it stays
    // gated on a genuine hardware-scanner burst.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50); // WEDGE_DEBOUNCE_MS
    });
    expect(submitCheckInScan).not.toHaveBeenCalled();

    // An explicit Enter, though, is a deliberate submit regardless of how the
    // text arrived.
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledWith("evt-live", pasted, "desk-1"));
    expect(lookupCheckInAttendees).not.toHaveBeenCalled();
  });

  it("routes a pasted ticket URL to a successful scan attempt on Enter (bot review, round 6)", async () => {
    // An operator who copies the whole link (e.g. from an email) rather than
    // just the token must still get a working check-in, not a doomed
    // name/email search for the URL text. normalizeScannedInput
    // (checkin/normalize.ts) already extracts the bare token from a full
    // ticket URL before it ever reaches submitCheckInScan — round 5's
    // looksLikeInternalToken gate ran before that normalization got a
    // chance, rejecting the URL outright and routing it to lookup instead.
    mockPageBootstrap();
    const token = "TEST-FIXTURE-TOKEN-NOT-REAL-SECRET-000001";
    const url = `https://admitto.example.com/t/${token}`;
    submitCheckInScan.mockResolvedValueOnce(cardResponse(token, "URL Pasted Person"));

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    fireEvent.paste(input);
    fireEvent.change(input, { target: { value: url } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50); // WEDGE_DEBOUNCE_MS
    });
    expect(submitCheckInScan).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledWith("evt-live", token, "desk-1"));
    expect(lookupCheckInAttendees).not.toHaveBeenCalled();
  });

  it("does not silently auto-submit a single-event long value dropped into an empty field, but Enter still attempts a scan (Codex review)", async () => {
    mockPageBootstrap();
    const value = "TEST-FIXTURE-TOKEN-NOT-REAL-SECRET-000001";
    submitCheckInScan.mockResolvedValueOnce(cardResponse(value, "One Shot Insert Person"));

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    // Browser autofill/autocomplete replacement, drag-and-drop text, IME
    // composition, or voice dictation can all insert a long value into an
    // empty field in one change event without ever firing a paste event —
    // so `justPasted` alone can't catch this. Only the length-jump-per-event
    // check does, for the purposes of NOT silently auto-submitting it.
    fireEvent.change(input, { target: { value } });

    // The auto-submit timer must not fire a scan for this one-shot insert.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50); // WEDGE_DEBOUNCE_MS
    });
    expect(submitCheckInScan).not.toHaveBeenCalled();

    // An explicit Enter still attempts it as a scan.
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledWith("evt-live", value, "desk-1"));
    expect(lookupCheckInAttendees).not.toHaveBeenCalled();
  });

  it("does not silently auto-submit a single-event long email dropped into an empty field, and Enter falls back to lookup (round 5/6, coverage restored)", async () => {
    mockPageBootstrap();
    submitCheckInScan.mockResolvedValueOnce({ status: "INVALID", confirmed: false });
    lookupCheckInAttendees.mockResolvedValueOnce([]);

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    // Same one-shot-insert shape as the token case above (autofill/IME/
    // drag-drop/voice dictation), but email-shaped content — the scan
    // attempt comes back no-match, and it falls back to lookup, same as the
    // typed/pasted email cases above.
    const value = "someone.long-name@international-trade-fair.example.com";
    fireEvent.change(input, { target: { value } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50); // WEDGE_DEBOUNCE_MS
    });
    expect(submitCheckInScan).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledWith("evt-live", value, "desk-1"));
    await vi.waitFor(() => expect(lookupCheckInAttendees).toHaveBeenCalledWith("evt-live", value));
  });

  it("still auto-submits a genuine fast wedge burst on Enter (no regression)", async () => {
    mockPageBootstrap();
    const token = "QRTOKEN-GENUINEWEDGE01-DPADPADPADPADPADPADP";
    submitCheckInScan.mockResolvedValueOnce(cardResponse(token, "Wedge Person"));

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    await typeWedge(input, token, { gapMs: 2 });
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledWith("evt-live", token, "desk-1"));
    expect(lookupCheckInAttendees).not.toHaveBeenCalled();
  });

  it("attempts a scan (not a lookup) for a short, burst-typed agency-style code on Enter (bot review, round 9)", async () => {
    // qr_payload/external_uuid (Mode B agency identifiers) aren't length-
    // constrained the way an internal token is — packages/tickets' own
    // tests use values like "AGENCY-QR-001" (13 chars, well under
    // WEDGE_AUTO_SUBMIT_LEN). A genuine hardware-scanner burst must still
    // attempt a scan for a short code like this, not fall straight to a
    // doomed name/email lookup just because it's short.
    mockPageBootstrap();
    const code = "AGENCY-QR-001";
    submitCheckInScan.mockResolvedValueOnce(cardResponse(code, "Agency Person"));

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    await typeWedge(input, code, { gapMs: 2 });
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledWith("evt-live", code, "desk-1"));
    expect(lookupCheckInAttendees).not.toHaveBeenCalled();
  });

  it("reports a burst-scanned code as invalid, not a lookup fallback, when Enter arrives before the auto-submit timer (bot review, round 9)", async () => {
    // A hardware wedge that appends its own Enter/CR terminator reaches
    // onKeyDown before the no-Enter auto-submit timer (WEDGE_DEBOUNCE_MS)
    // gets a chance to fire — this must still be treated as a definitive
    // scan (no ambiguity, no lookup fallback), the same as if the timer had
    // fired it. A burst-typed value that turns out INVALID should report
    // as an invalid scan, not silently retry as a name/email search.
    mockPageBootstrap();
    const token = "QRTOKEN-BURST-THEN-ENTER-BEFORE-TIMER-00000";
    submitCheckInScan.mockResolvedValueOnce({ status: "INVALID", confirmed: false });

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    await typeWedge(input, token, { gapMs: 2 });
    // Enter fires immediately — well before the 50ms auto-submit debounce.
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() => expect(submitCheckInScan).toHaveBeenCalledWith("evt-live", token, "desk-1"));
    expect(lookupCheckInAttendees).not.toHaveBeenCalled();
  });

  it("reports a bad code as invalid, not 'manual lookup is disabled', in a QR-only event (bot review, round 10)", async () => {
    // allow_manual_lookup: false means the operator explicitly can't search
    // by name/email — but a long, non-burst submit still tries a scan first
    // (round 6+) with a lookup fallback on INVALID (round 6). Without gating
    // that fallback on allowManualLookup too, a bad QR/token in a QR-only
    // event fell into submitScanOrLookupImpl, whose own first check bails
    // immediately with "Manual lookup is disabled" — the wrong message for
    // an operator who scanned a code and never attempted a name search, and
    // the normal invalid-scan feedback never ran.
    mockPageBootstrap();
    fetchCheckInOpsConfig.mockResolvedValue({
      require_confirm_on_scan: false,
      badge_at_entry: true,
      allow_manual_lookup: false,
      auto_advance_on_valid: true,
    });
    const value = "someone.long-name@international-trade-fair.example.com";
    submitCheckInScan.mockResolvedValueOnce({ status: "INVALID", confirmed: false });

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    await typeWedge(input, value, { gapMs: 60 });
    fireEvent.keyDown(input, { key: "Enter" });

    await screen.findByText(
      "This code is not valid for this event. Check the QR or use manual lookup.",
    );
    expect(
      screen.queryByText("Manual lookup is disabled for this event — use QR scan only."),
    ).toBeNull();
    expect(lookupCheckInAttendees).not.toHaveBeenCalled();
  });
});

describe("CheckInPage scan queue — event timestamp vs handler wall-clock (#262 review)", () => {
  it("classifies a genuine fast burst correctly even when Date.now() would suggest otherwise", async () => {
    mockPageBootstrap();
    // Token-shaped (base64url, 40-60 chars) so it passes looksLikeInternalToken.
    const token = "QRTOKEN-REALWEDGE00001-DPADPADPADPADPADPADP";
    submitCheckInScan.mockResolvedValueOnce(cardResponse(token, "Real Wedge Person"));

    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>("QR scan or search");

    // Date.now() is deliberately made unreliable, jumping 1000ms on every
    // call — simulating a main thread so busy handling other work (e.g. the
    // previous attendee's response resolving and re-rendering) that
    // Date.now() at handler-execution time looks nothing like the real gap
    // between keystrokes. If the code used Date.now() for the burst check,
    // every character after the first would look like a >30ms human pause
    // and the scan would incorrectly fall back to requiring Enter to be
    // pressed and route through lookup instead once submitted.
    let fakeNow = 0;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      fakeNow += 1000;
      return fakeNow;
    });

    try {
      // Each character's own event timestamp is a real, tightly-packed
      // burst (2ms apart) — what the browser actually recorded when the
      // wedge injected it, independent of whenever React gets around to
      // running the handler.
      const baseTime = 5_000;
      await typeWedge(input, token, { baseTime });
    } finally {
      dateSpy.mockRestore();
    }

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(submitCheckInScan).toHaveBeenCalledWith("evt-live", token, "desk-1"));
    expect(lookupCheckInAttendees).not.toHaveBeenCalled();
  });
});
