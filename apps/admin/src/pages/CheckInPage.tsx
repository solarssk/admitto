import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useParams } from "react-router-dom";
import { Button, Card, useToast } from "@admitto/ui";
import {
  ApiError,
  fetchAttendeeCard,
  fetchCheckInEvents,
  fetchCheckInHistory,
  fetchCheckInOpsConfig,
  fetchCheckInStats,
  lookupCheckInAttendees,
  submitAttendeeNote,
  submitCheckInAdmit,
  submitCheckInScan,
  submitItemAction,
  undoLastCheckIn,
  revokeAttendeeCheckIn,
  revokeItemState,
} from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AttendeeCardDto, CheckInHistoryEntry, CheckInScanResponse, OpsConfigDto } from "../api/types.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isOrgAdmin } from "../auth/capabilities.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { CHECKIN_DUPLICATE_DEBOUNCE_MS, normalizeScannedInput } from "../checkin/normalize.js";
import { scanResultFromCard } from "../checkin/cardScanResult.js";
import { shouldAutoAdvance } from "../checkin/autoAdvance.js";
import { canMutateCheckin } from "../checkin/connection.js";
import { ScanFeedback, feedbackCopy } from "../checkin/ScanFeedback.js";
import {
  playScanFeedback,
  scanSoundMuteIconClass,
  scanSoundMuteLabel,
  scanSoundMuteTitle,
  useScanSoundMuted,
} from "../checkin/scanSoundFeedback.js";
import { AttendeeCard } from "../checkin/AttendeeCard.js";
import { CameraOverlay } from "../checkin/CameraOverlay.js";
import { CheckinConnectionBanner, CheckinConnectionLiveRegion } from "../checkin/ConnectionBanner.js";
import { CkEmptyState } from "../checkin/CkEmptyState.js";
import { CkInlineCamera } from "../checkin/CkInlineCamera.js";
import { isDesktopViewport, useIsDesktop } from "../hooks/useIsDesktop.js";
import {
  isAdmitDedupHit,
  mergeCheckInHistory,
  registerAdmitDedup,
  seedAdmitDedupFromHistory,
} from "../checkin/admitDedup.js";
import { useEventStream, type StreamCheckinEvent } from "../hooks/useEventStream.js";
import { checkinSearchFieldAttrs } from "../checkin/searchFieldAttrs.js";
import { ScanHistoryList } from "../checkin/ScanHistoryList.js";

const PENDING_MS = 5000;
const WEDGE_AUTO_SUBMIT_LEN = 20;
const WEDGE_DEBOUNCE_MS = 50;
// Pause after the last typed character before the scan bar fetches attendee
// suggestions. Long enough not to fire mid-word, short enough to feel live.
const SUGGEST_DEBOUNCE_MS = 300;
// A hardware keyboard-wedge scanner injects characters far faster than a human
// can type — even fast typists rarely sustain sub-30ms gaps across many
// consecutive keystrokes. Used to tell "typing a long manual query" apart from
// "a wedge scan without a CR terminator" so length alone doesn't auto-submit.
const WEDGE_MAX_INTER_KEY_GAP_MS = 30;
const HISTORY_CAP = 8;
const LOOKUP_DISABLED_MSG =
  "Manual lookup is disabled for this event — use QR scan only.";
const LOOKUP_NO_MATCH_MSG = "No attendees matched that search.";

/** Build a sidebar history row from a live SSE check-in event. */
function historyEntryFromStream(event: StreamCheckinEvent, eventId: string): CheckInHistoryEntry {
  return {
    id: `sse-${event.attendeeId}-${event.admittedAt}`,
    event_id: eventId,
    attendee_id: event.attendeeId,
    status: "admitted",
    checked_in_at: event.admittedAt,
    checked_in_by: event.operatorId,
    device_id: event.deviceLabel,
    source: null,
    attendee: {
      name: event.attendeeName,
      ticket_type: event.ticketType,
    },
  };
}

const DEFAULT_OPS_CONFIG: OpsConfigDto = {
  require_confirm_on_scan: false,
  badge_at_entry: true,
  allow_manual_lookup: true,
  auto_advance_on_valid: true,
};

export interface CheckInPageProps {
  eventTitle?: string;
  eventTimezone?: string;
  eventDate?: string | null;
  eventOrganizationId?: string;
  useCamera?: boolean;
  onUseCameraChange?: (open: boolean) => void;
}

export function CheckInPage({
  eventTitle = "Event",
  eventTimezone: eventTimezoneProp,
  eventDate: eventDateProp,
  eventOrganizationId: eventOrganizationIdProp,
  useCamera = false,
  onUseCameraChange,
}: CheckInPageProps) {
  const { eventId } = useParams();
  const [eventTimezone, setEventTimezone] = useState(eventTimezoneProp ?? "UTC");
  const [eventDate, setEventDate] = useState<string | null>(eventDateProp ?? null);
  const [eventOrganizationId, setEventOrganizationId] = useState<string | null>(
    eventOrganizationIdProp ?? null,
  );
  const { deviceLabel, assignments } = useAuth();
  const canRevokeCheckIn = isOrgAdmin(assignments, eventOrganizationId);
  const { state: connectionState, reportApiError } = useConnectionState();
  const { addToast } = useToast();
  const canAct = canMutateCheckin(connectionState);
  const [scanSoundMuted, toggleScanSoundMuted] = useScanSoundMuted();
  const isOperatorShell = onUseCameraChange === undefined;
  const isDesktop = useIsDesktop();
  const [operatorCamera, setOperatorCamera] = useState(() => !isDesktopViewport());
  const cameraActive = isOperatorShell ? operatorCamera : useCamera;
  const showMobileOverlay = cameraActive && !isDesktop;
  const showInlineCamera = cameraActive && isDesktop;
  // applyResponse (below) is read from inside runScanImpl, a useCallback that
  // isn't recreated when the camera is toggled — without a ref it would keep
  // seeing whatever showInlineCamera was at mount (always false), never the
  // current value, and silently never route a no-match scan to the toast.
  // Assigned directly in the render body (matching historyRef below) rather
  // than a useEffect, so the ref is current the instant this render commits
  // instead of one tick later (bot review, round 5).
  const showInlineCameraRef = useRef(showInlineCamera);
  showInlineCameraRef.current = showInlineCamera;
  // runScanImpl (declared before submitScanOrLookupImpl further down) needs
  // to call it on a no-match fallback (see runScanImpl's fallbackToLookup
  // param) — a ref sidesteps both the declaration-order problem and the
  // stale-closure trap of listing it in runScanImpl's own deps array (same
  // reasoning as showInlineCameraRef above). Assigned once submitScanOrLookupImpl
  // itself is declared.
  const submitScanOrLookupImplRef = useRef<((trimmed: string) => Promise<boolean>) | null>(null);

  const setCameraActive = useCallback(
    (open: boolean) => {
      if (isOperatorShell) setOperatorCamera(open);
      else onUseCameraChange?.(open);
    },
    [isOperatorShell, onUseCameraChange],
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const operatorCameraActionsRef = useRef<HTMLDivElement>(null);
  const returnFocusUseCameraRef = useRef(false);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  const wedgeTimerRef = useRef<number | null>(null);
  const wedgeLastCharAtRef = useRef(0);
  const wedgeIsBurstRef = useRef(true);
  const suggestTimerRef = useRef<number | null>(null);
  // Monotonic guard: only the latest in-flight suggestion request may render.
  const suggestSeqRef = useRef(0);
  // A clipboard paste (or autofill) delivers a long value in a single change
  // event with no prior keystroke to compare timing against — mechanically
  // identical, to handleBufferChange, to "the first character of a real
  // wedge burst". Set by the input's onPaste handler and consumed on the
  // very next buffer change so pasted text is never treated as a burst
  // (#262 review).
  const wedgeJustPastedRef = useRef(false);
  const recentAdmits = useRef(new Map<string, number>());
  const historyRef = useRef<CheckInHistoryEntry[]>([]);
  // Serializes scan/lookup submissions (FIFO) so a wedge scan arriving while
  // the previous one is still in flight is queued, not lost or interleaved.
  const scanChainRef = useRef<Promise<unknown>>(Promise.resolve());

  const runExclusive = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = scanChainRef.current.then(fn);
    scanChainRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const prependAdmit = useCallback((entry: CheckInHistoryEntry, admittedAt: string) => {
    if (isAdmitDedupHit(recentAdmits.current, entry.attendee_id, admittedAt)) return;

    const exists = historyRef.current.some(
      (row) => row.attendee_id === entry.attendee_id && row.checked_in_at === admittedAt,
    );
    registerAdmitDedup(recentAdmits.current, entry.attendee_id, admittedAt);
    if (exists) return;

    const next = [entry, ...historyRef.current].slice(0, HISTORY_CAP);
    historyRef.current = next;
    setHistory(next);
    setAdmittedCount((count) => count + 1);
  }, []);

  const applyLocalAdmit = useCallback(
    (response: CheckInScanResponse) => {
      if (!eventId || response.status !== "VALID" || !response.admittedAt) return;
      const attendeeId = response.card?.id ?? response.attendeeId;
      const admittedCard = response.card;
      if (!attendeeId || !admittedCard) return;
      if (isAdmitDedupHit(recentAdmits.current, attendeeId, response.admittedAt)) return;
      prependAdmit(
        {
          id: `local-${attendeeId}-${response.admittedAt}`,
          event_id: eventId,
          attendee_id: attendeeId,
          status: "admitted",
          checked_in_at: response.admittedAt,
          checked_in_by: null,
          device_id: deviceLabel ?? null,
          source: null,
          attendee: {
            name: admittedCard.name,
            ticket_type: admittedCard.ticket_type,
            company: admittedCard.company,
            department: admittedCard.department,
          },
        },
        response.admittedAt,
      );
    },
    [deviceLabel, eventId, prependAdmit],
  );

  const handleRemoteCheckin = useCallback(
    (event: StreamCheckinEvent) => {
      if (!eventId) return;
      prependAdmit(historyEntryFromStream(event, eventId), event.admittedAt);
    },
    [eventId, prependAdmit],
  );

  const { status: streamStatus } = useEventStream(eventId, handleRemoteCheckin);

  const [buffer, setBuffer] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<CheckInScanResponse | null>(null);
  const [card, setCard] = useState<AttendeeCardDto | null>(null);
  const [suggestions, setSuggestions] = useState<Awaited<ReturnType<typeof lookupCheckInAttendees>>>([]);
  const [history, setHistory] = useState<CheckInHistoryEntry[]>([]);
  historyRef.current = history;
  const [admittedCount, setAdmittedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [admitOrigin, setAdmitOrigin] = useState<"scan" | "manual">("manual");
  const [overlayManualError, setOverlayManualError] = useState<string | null>(null);
  const [opsConfig, setOpsConfig] = useState<OpsConfigDto>(DEFAULT_OPS_CONFIG);

  const deviceId = deviceLabel ?? undefined;
  const allowManualLookup = opsConfig.allow_manual_lookup;
  const autoAdvanceOnValid = opsConfig.auto_advance_on_valid;

  useEffect(() => {
    if (eventTimezoneProp) {
      setEventTimezone(eventTimezoneProp);
      setEventDate(eventDateProp ?? null);
      setEventOrganizationId(eventOrganizationIdProp ?? null);
      return;
    }
    if (!eventId) return;
    let cancelled = false;
    fetchCheckInEvents()
      .then((events) => {
        const found = events.find((e) => e.id === eventId);
        if (!cancelled) {
          setEventTimezone(found?.timezone ?? "UTC");
          setEventDate(found?.date ?? null);
          setEventOrganizationId(found?.organization_id ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEventTimezone("UTC");
          setEventDate(null);
          setEventOrganizationId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, eventTimezoneProp, eventDateProp, eventOrganizationIdProp]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    fetchCheckInOpsConfig(eventId)
      .then((ops) => {
        if (!cancelled) setOpsConfig(ops);
      })
      .catch(() => {
        if (!cancelled) setOpsConfig(DEFAULT_OPS_CONFIG);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // A transport error can be set while the connection is down (e.g. a
  // Recent-scans click that isn't gated on `canAct`, #458) and then sit
  // stale on screen once the server responds again — clear it the moment
  // the connection actually recovers, not only on the next retried action.
  useEffect(() => {
    if (connectionState === "connected") setTransportError(null);
  }, [connectionState]);

  const focusScan = useCallback(() => {
    if (showMobileOverlay) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [showMobileOverlay]);

  const refreshStatsOnly = useCallback(async () => {
    if (!eventId) return;
    try {
      const stats = await fetchCheckInStats(eventId);
      setAdmittedCount(stats.admitted_count);
      setTotalCount(stats.total_count);
    } catch {
      /* read-only context */
    }
  }, [eventId]);

  const refreshSidebar = useCallback(async () => {
    if (!eventId) return;
    try {
      const [h, stats] = await Promise.all([
        fetchCheckInHistory(eventId, 8),
        fetchCheckInStats(eventId),
      ]);
      setHistory((prev) => {
        const merged = mergeCheckInHistory(h, prev, HISTORY_CAP);
        historyRef.current = merged;
        seedAdmitDedupFromHistory(recentAdmits.current, merged);
        return merged;
      });
      setAdmittedCount(stats.admitted_count);
      setTotalCount(stats.total_count);
    } catch {
      /* read-only context */
    }
  }, [eventId]);

  useEffect(() => {
    focusScan();
    void refreshSidebar();
  }, [focusScan, eventId, refreshSidebar]);

  useEffect(() => {
    return () => {
      if (wedgeTimerRef.current != null) window.clearTimeout(wedgeTimerRef.current);
      if (pendingTimerRef.current != null) window.clearTimeout(pendingTimerRef.current);
      if (suggestTimerRef.current != null) window.clearTimeout(suggestTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (cameraActive || !returnFocusUseCameraRef.current || !isOperatorShell) return;
    returnFocusUseCameraRef.current = false;
    requestAnimationFrame(() => {
      operatorCameraActionsRef.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus();
    });
  }, [cameraActive, isOperatorShell]);

  const clearPendingTimer = () => {
    if (pendingTimerRef.current != null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  };

  // `fromScan` restricts the camera toast-diversion below to actual scan
  // attempts — admitCurrent (the Confirm-check-in button) also funnels
  // through here, and can itself resolve to a bare, card-less INVALID if the
  // attendee vanished server-side between the card loading and the click
  // (packages/tickets/src/admit.ts: `if (!attendee) return { status:
  // "INVALID", ... }`); that's a confirm failure, not a no-match scan, and
  // showing scan-specific copy ("Check the QR...") while wiping the card the
  // operator was just looking at would be actively misleading (bot review,
  // round 5).
  const applyResponse = (response: CheckInScanResponse, fromScan = false) => {
    // Every settled outcome gets a beep/vibration, including the
    // toast-diverted INVALID branch below — the operator needs the
    // non-visual cue regardless of which surface renders the result.
    playScanFeedback(response.status);
    // Keyed on the literal INVALID status, not a card-less response in
    // general: a PREVIEW response can legitimately arrive without an
    // embedded card too (packages/tickets/src/checkin.ts: `card: card ??
    // undefined`, when getAttendeeCard's own read comes back empty) — the
    // code below already handles that by fetching the card separately.
    // Widening this to `!response.card` (round 5's own "consistency"
    // change) intercepted that legitimate case: it showed the invalid-code
    // toast and wiped scanResult for a real, pending scan, and since
    // showResultCard requires both card and scanResult, the confirm card
    // that fetch was about to populate could never appear (bot review,
    // round 8).
    if (showInlineCameraRef.current && fromScan && response.status === "INVALID") {
      // Desktop camera is scan-only (unlike the mobile overlay, which doubles
      // as the operator's check-in/item-issuing surface) — no result ever
      // renders on top of it. A no-match scan reports the same way manual
      // lookup's no-match does: a toast, camera keeps scanning (PO review).
      addToast(feedbackCopy("INVALID"), "warning");
      // showInlineCameraRef only says the camera toggle is on, not that the
      // camera is what's actually visible right now — an attendee card from
      // an earlier scan may still be showing (it hides the camera, but the
      // scan bar above it stays live). This new scan supersedes that card
      // even though it doesn't get one of its own, or the toast would fire
      // over a stale, unrelated attendee's card (bot review).
      clearDisplayedResult();
      return;
    }
    setScanResult(response);
    if (response.card) {
      setCard(response.card);
    } else if (response.status === "INVALID" || response.status === "REVOKED") {
      setCard(null);
    }
  };

  /** Clears only the displayed result/error state — never the buffer or the
   * wedge timer, which may already belong to a different, newer scan that's
   * mid-burst (see maybeAutoAdvance below). */
  const clearDisplayedResult = useCallback(() => {
    setScanResult(null);
    setCard(null);
    setTransportError(null);
    setOverlayManualError(null);
  }, []);

  // Header "Disable camera" toggles (AdminCheckInRoute, operator desktop) flip
  // the parent's camera state directly and don't go through closeInlineCamera's
  // onReset — clear any stale scan/card display here so a stopped-then-restarted
  // camera doesn't overlay an old result (#381).
  //
  // showInlineCamera (desktop) and showMobileOverlay are two different
  // presentation surfaces for the same card/scanResult state — a card looked
  // up from the desktop scan bar, then carried straight into the mobile
  // camera overlay on open (or the reverse on close), reads as the wrong
  // person's result appearing in a surface that never scanned them (PO
  // review). Clears unconditionally on entry, exit, AND a swap between the
  // two surfaces — tracked as a 3-state "which surface is showing" value
  // rather than a boolean, because showInlineCamera/showMobileOverlay
  // partition cameraActive by isDesktop (cameraActive && isDesktop /
  // cameraActive && !isDesktop), so their OR is always exactly cameraActive:
  // a viewport resize/rotation crossing the desktop breakpoint while the
  // camera stays on swaps which surface renders without cameraActive ever
  // changing, and a boolean derived from either would miss it (code review).
  type ActiveCameraSurface = "none" | "inline" | "overlay";
  const activeCameraSurface: ActiveCameraSurface = showInlineCamera
    ? "inline"
    : showMobileOverlay
      ? "overlay"
      : "none";
  const prevActiveCameraSurfaceRef = useRef(activeCameraSurface);
  useEffect(() => {
    if (prevActiveCameraSurfaceRef.current !== activeCameraSurface) clearDisplayedResult();
    prevActiveCameraSurfaceRef.current = activeCameraSurface;
  }, [activeCameraSurface, clearDisplayedResult]);

  /** User-initiated reset (Escape, Cancel button) — also clears the input and
   * cancels any pending wedge timer, since the user explicitly wants a clean slate. */
  const resetScan = useCallback(() => {
    if (wedgeTimerRef.current != null) {
      window.clearTimeout(wedgeTimerRef.current);
      wedgeTimerRef.current = null;
    }
    if (suggestTimerRef.current != null) {
      window.clearTimeout(suggestTimerRef.current);
      suggestTimerRef.current = null;
    }
    suggestSeqRef.current += 1;
    setSuggestions([]);
    clearDisplayedResult();
    setBuffer("");
    focusScan();
  }, [clearDisplayedResult, focusScan]);

  const maybeAutoAdvance = useCallback(
    (response: CheckInScanResponse) => {
      if (!shouldAutoAdvance(response, { autoAdvanceOnValid })) return;
      // Dismiss THIS scan's confirmation only — must not clear the buffer or
      // cancel the wedge timer, which may already hold a different, newer
      // scan's in-progress keystrokes (#277 follow-up review).
      clearDisplayedResult();
    },
    [autoAdvanceOnValid, clearDisplayedResult],
  );

  const runWithPending = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    clearPendingTimer();
    pendingTimerRef.current = window.setTimeout(() => {
      setPending(true);
    }, PENDING_MS);
    try {
      return await fn();
    } finally {
      clearPendingTimer();
      setPending(false);
    }
  };

  const handleApiFailure = (err: unknown) => {
    if (err instanceof ApiError) {
      reportApiError(err.status);
      setTransportError(
        err.status === 401
          ? "Session expired — sign in again."
          : operatorApiErrorMessage(err, "Request failed."),
      );
    } else {
      setTransportError("Request failed. Try again.");
    }
  };

  // The queued/deferred half of a scan: only the actual network round-trip.
  // Dedup and buffer-clear must NOT live here — they'd measure time and clear
  // visibility from whenever this reaches the front of the queue (dequeue
  // time), not from when the physical scan actually happened (enqueue time).
  // With a backlog, that gap can exceed CHECKIN_DUPLICATE_DEBOUNCE_MS and
  // silently defeat the duplicate-scan guard, or leave stale text on screen
  // for the next physical scan's keystrokes to land on top of.
  //
  // Resolves `true` only once a positive outcome is actually known — an
  // attendee was found (any non-INVALID status) or the lookup fallback
  // opened a single match — not merely once the request was *sent*. The
  // mobile manual-entry overlay's onManualEntry prop closes on `true`; it
  // used to receive that signal immediately (a bare `void runScan(...);
  // return Promise.resolve(true)`), before the scan — let alone its lookup
  // fallback — had even started, so the overlay could close while the
  // request was still in flight and any error/no-match ended up set behind
  // an already-hidden screen (bot review, round 7).
  const runScanImpl = useCallback(
    async (scanned: string, fallbackToLookup = false): Promise<boolean> => {
      if (!eventId) return false;
      setBusy(true);
      setTransportError(null);
      try {
        const response = await runWithPending(() => submitCheckInScan(eventId, scanned, deviceId));
        if (!response) return false;
        if (fallbackToLookup && allowManualLookup && response.status === "INVALID") {
          // An explicit submit (Enter/Search) that didn't resolve as a scan
          // code — try it as a name/email search instead of reporting
          // "invalid code". The server's resolver already recognizes every
          // valid code shape (raw token, full ticket URL, agency QR
          // payload/external UUID — resolve.ts), so a scan failure here
          // means it genuinely isn't a code; the only other thing an
          // operator explicitly submits is a manual search that happened to
          // be long enough to attempt a scan first. Camera-decoded scans and
          // the hands-free wedge auto-submit never set this — a QR a camera
          // actually decoded, or a genuine hardware burst, isn't a name to
          // fall back to (bot review, round 6 — the previous fix tried to
          // recognize a token by its shape client-side, which by
          // construction can't also recognize a ticket URL or an
          // externally-issued agency ID).
          //
          // Gated on allowManualLookup too (bot review, round 10): without
          // it, a QR-only event (manual lookup deliberately turned off)
          // still fell into this branch for a bad scan, and
          // submitScanOrLookupImpl's own first check immediately bails with
          // "Manual lookup is disabled for this event" — the wrong message
          // for an operator who scanned a QR and never attempted a name
          // search at all, and it skips applyResponse below entirely, so
          // the normal invalid-scan feedback (toast/card-clearing) never
          // ran either. When lookup isn't allowed, an INVALID scan is
          // unambiguous — there's no second interpretation to fall back to.
          return (await submitScanOrLookupImplRef.current?.(scanned)) ?? false;
        }
        applyResponse(response, true);
        maybeAutoAdvance(response);
        setAdmitOrigin("scan");
        if (response.status === "PREVIEW" && response.attendeeId && !response.card) {
          const loaded = await fetchAttendeeCard(eventId, response.attendeeId);
          setCard(loaded);
        }
        if (response.status === "VALID" && response.admittedAt) {
          applyLocalAdmit(response);
          void refreshStatsOnly();
        } else {
          void refreshSidebar();
        }
        return response.status !== "INVALID";
      } catch (err) {
        setScanResult(null);
        handleApiFailure(err);
        return false;
      } finally {
        setBusy(false);
        focusScan();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleApiFailure and runWithPending are plain component functions (not useCallback); adding them would recreate this callback every render — to be refactored in #280
    [
      deviceId,
      eventId,
      focusScan,
      maybeAutoAdvance,
      applyLocalAdmit,
      refreshSidebar,
      refreshStatsOnly,
      reportApiError,
      allowManualLookup,
    ],
  );

  // Synchronous entry point: normalizes, dedups, and clears the buffer
  // immediately at call time (not once its turn in the queue arrives), then
  // enqueues only the network round-trip so it still runs FIFO behind any
  // scan already in flight.
  const runScan = useCallback(
    (raw: string, fallbackToLookup = false): Promise<boolean> => {
      if (!eventId || !canAct) return Promise.resolve(false);
      const scanned = normalizeScannedInput(raw);
      if (!scanned) return Promise.resolve(false);

      const now = Date.now();
      const last = lastScanRef.current;
      if (last && last.value === scanned && now - last.at < CHECKIN_DUPLICATE_DEBOUNCE_MS) {
        setBuffer("");
        focusScan();
        return Promise.resolve(false);
      }
      lastScanRef.current = { value: scanned, at: now };
      setBuffer("");
      if (suggestTimerRef.current != null) window.clearTimeout(suggestTimerRef.current);
      suggestSeqRef.current += 1;
      setSuggestions([]);

      return runExclusive(() => runScanImpl(scanned, fallbackToLookup));
    },
    [canAct, eventId, focusScan, runExclusive, runScanImpl],
  );

  const closeInlineCamera = useCallback(() => {
    returnFocusUseCameraRef.current = isOperatorShell;
    setCameraActive(false);
    if (!isOperatorShell) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOperatorShell, setCameraActive]);

  // Queued alongside scans: this updates the same scanResult/card the
  // operator is looking at, keyed to a specific attendeeId captured at click
  // time. Without queueing, a scan for a different attendee could resolve
  // first and then this (slower) response would overwrite the display back
  // to the attendee the operator already moved past (#277 review).
  const admitCurrent = (attendeeId: string, method: "scan" | "manual" = "manual") =>
    runExclusive(async () => {
      if (!eventId || !canAct) return;
      setBusy(true);
      setTransportError(null);
      try {
        const response = await runWithPending(() =>
          submitCheckInAdmit(eventId, attendeeId, deviceId, method),
        );
        if (response) {
          applyResponse(response);
          maybeAutoAdvance(response);
          if (response.status === "VALID" && response.admittedAt) {
            applyLocalAdmit(response);
            void refreshStatsOnly();
          } else {
            void refreshSidebar();
          }
        }
      } catch (err) {
        handleApiFailure(err);
      } finally {
        setBusy(false);
        focusScan();
      }
    });

  // Raw implementation, called directly (not re-queued) from
  // submitScanOrLookupImpl below, which is already running inside its own
  // queue turn — wrapping this in runExclusive there would deadlock.
  const openLookupResultImpl = async (attendeeId: string) => {
    if (!eventId) return;
    setBusy(true);
    try {
      const loaded = await fetchAttendeeCard(eventId, attendeeId);
      setCard(loaded);
      setScanResult(scanResultFromCard(loaded));
      setAdmitOrigin("manual");
      setBuffer("");
      suggestSeqRef.current += 1;
      setSuggestions([]);
    } catch (err) {
      handleApiFailure(err);
    } finally {
      setBusy(false);
      focusScan();
    }
  };

  // Queued wrapper for a suggestion-row click (an external entry point,
  // unlike the internal auto-select call below).
  const openLookupResult = (attendeeId: string) => runExclusive(() => openLookupResultImpl(attendeeId));

  // Typeahead under the scan bar: best-effort and unqueued — a read-only
  // lookup must not wait behind in-flight scans; the seq guard drops stale
  // responses so only the latest query renders.
  const fetchSuggestions = async (query: string) => {
    if (!eventId) return;
    const seq = ++suggestSeqRef.current;
    try {
      const results = await lookupCheckInAttendees(eventId, query);
      if (seq === suggestSeqRef.current) setSuggestions(results);
    } catch {
      // Silent: suggestions are an assist, explicit Enter still surfaces errors.
    }
  };

  // Queued/deferred half: manual-lookup API call only. The "is this actually
  // a long scan token, not a manual query" branch lives in the synchronous
  // wrapper below so a CR-terminated wedge scan is deduped/cleared at the
  // moment it arrives, not delayed behind this function's own queue turn.
  const submitScanOrLookupImpl = useCallback(
    async (trimmed: string): Promise<boolean> => {
      if (!eventId || !canAct) return false;

      if (!allowManualLookup) {
        if (showMobileOverlay) setOverlayManualError(LOOKUP_DISABLED_MSG);
        else addToast(LOOKUP_DISABLED_MSG, "warning");
        return false;
      }

      setBusy(true);
      setTransportError(null);
      setOverlayManualError(null);
      try {
        const results = await lookupCheckInAttendees(eventId, trimmed);
        if (results.length === 1) {
          // Buffer already cleared at call time by the submitScanOrLookup
          // wrapper — do not clear it again here, or a newer query the
          // operator started typing while this lookup was pending would be
          // wiped out too.
          await openLookupResultImpl(results[0].id);
          return true;
        }
        if (results.length === 0) {
          if (showMobileOverlay) setOverlayManualError(LOOKUP_NO_MATCH_MSG);
          else addToast(LOOKUP_NO_MATCH_MSG, "warning");
        } else if (showMobileOverlay) {
          setOverlayManualError("Multiple matches — narrow your search.");
        } else {
          // Desktop: show the matches as scan-bar suggestions to pick from.
          setSuggestions(results);
        }
        return false;
      } catch (err) {
        if (err instanceof ApiError) {
          reportApiError(err.status);
          const message =
            err.status === 401
              ? "Session expired — sign in again."
              : operatorApiErrorMessage(err, "Request failed.");
          if (showMobileOverlay) setOverlayManualError(message);
          else setTransportError(message);
        } else if (showMobileOverlay) {
          setOverlayManualError("Request failed. Try again.");
        } else {
          setTransportError("Request failed. Try again.");
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openLookupResultImpl is a plain component function (not useCallback); adding it would recreate this callback every render — to be refactored in #280
    [allowManualLookup, addToast, canAct, eventId, reportApiError, showMobileOverlay],
  );
  submitScanOrLookupImplRef.current = submitScanOrLookupImpl;

  // Synchronous entry point, mirroring runScan above: a long buffer is
  // recognized and delegated to runScan (which does its own dedup/clear)
  // immediately at call time, regardless of queue backlog. Only genuine
  // manual-lookup queries get enqueued behind in-flight scans/lookups.
  //
  // Clears the buffer here too (not only on the single-match success path
  // inside submitScanOrLookupImpl) so a wedge scan arriving while a short
  // lookup is still in flight can't get appended after the old query text —
  // the combined string would otherwise cross the scan-length threshold and
  // get auto-submitted as a corrupted, unmatchable scan payload (#277 review).
  // Shared routing logic for both submit entry points (main scan bar and the
  // mobile camera overlay's manual-entry field, called directly at each call
  // site below). An explicit Enter/Search-button submit is unconditionally
  // an intentional "try this now" — unlike the silent, no-Enter auto-submit
  // in handleBufferChange below, which still requires wedgeIsBurstRef (a
  // real hardware scanner) since it fires with no user confirmation at all.
  //
  // A long value (>= WEDGE_AUTO_SUBMIT_LEN, matching the suggestion
  // dropdown's own cutoff) is tried as a scan first; runScan's
  // fallbackToLookup falls back to a name/email search if that comes back
  // INVALID. Earlier attempts tried to recognize a token by its client-side
  // shape up front (bare length, then length + no space/@, then a precise
  // base64url regex) to decide scan-vs-lookup before ever asking the server —
  // all three were incomplete, since the server's resolver also accepts a
  // full ticket URL and an externally-issued agency QR payload/UUID, neither
  // of which share the internal token's shape (resolve.ts; bot review, round
  // 6). Trying the scan first delegates "is this a valid code" to the
  // server, which already knows every valid shape, instead of the client
  // re-guessing an incomplete subset of them.
  //
  // `isBurst` also feeds the decision (bot review, round 9), for two
  // reasons: a hardware wedge scanner that appends its own Enter/CR
  // terminator reaches this function (via onKeyDown, below) *before* the
  // no-Enter auto-submit timer gets a chance to fire — without checking it
  // here too, a burst-scanned code that turns out INVALID would fall back to
  // a name/email search instead of reporting as the invalid scan it was, and
  // a *short* one (an agency QR payload/external UUID isn't length-
  // constrained the way an internal token is — e.g. "AGENCY-QR-001") would
  // miss the length cutoff and go straight to a doomed lookup, never
  // attempting a scan at all. A genuine burst is trusted at any length; a
  // burst is never ambiguous the way typed/pasted text is, so it also skips
  // the lookup fallback — the resolver already checked every valid shape.
  //
  // Deliberately a parameter, not read from wedgeIsBurstRef.current inside
  // this function: that ref tracks the *main scan bar's* typing only — the
  // mobile camera overlay's manual-entry field (onManualEntry, below) is a
  // separate input nothing ever wedges into, so its calls correctly default
  // this to false (never treated as a burst) instead of inheriting whatever
  // stale value the main scan bar's ref happens to hold.
  const submitOrLookup = useCallback(
    (query: string, isBurst = false): Promise<boolean> => {
      const trimmed = query.trim();
      if (!trimmed) return Promise.resolve(false);

      if (trimmed.length >= WEDGE_AUTO_SUBMIT_LEN || isBurst) {
        return runScan(trimmed, !isBurst);
      }

      setBuffer("");
      // Cancel a pending typeahead request for the same text — the explicit
      // submit below supersedes it (single match opens the card directly).
      if (suggestTimerRef.current != null) window.clearTimeout(suggestTimerRef.current);
      suggestSeqRef.current += 1;
      return runExclusive(() => submitScanOrLookupImpl(trimmed));
    },
    [runExclusive, runScan, submitScanOrLookupImpl],
  );

  // Shared by onItemAction and onRevokeItem below — same queuing/busy/error
  // shape, differing only in which endpoint they call. Queued: same
  // rationale as admitCurrent — this reads card.id at run time and
  // overwrites setCard, so it must not race a scan that could swap in a
  // different attendee's card first (#277 review). Resolves `true`/`false`
  // (not just void) so CameraOverlayItemIssuing's optimistic "issued" mark
  // (set synchronously at click time, before this promise settles — see its
  // own comment) can be reverted on `false` instead of assuming every click
  // succeeded; handleApiFailure still fires the toast either way (CodeRabbit
  // review — a `pending` prop toggled around this call was the previous
  // attempt, but `pending` only flips after a 5s delay, so it never
  // transitioned for the fast failures that actually matter here).
  const runItemMutation = (
    apiCall: (eventId: string, attendeeId: string) => Promise<{ card: AttendeeCardDto }>,
  ): Promise<boolean> =>
    runExclusive(async () => {
      if (!eventId || !card || !canAct) return false;
      setBusy(true);
      // Clear any prior failure banner so a retry that now succeeds doesn't
      // leave a stale "Request failed" over a successful outcome (review
      // finding) — mirrors runScanImpl/admitCurrent.
      setTransportError(null);
      try {
        const { card: updated } = await apiCall(eventId, card.id);
        setCard(updated);
        void refreshSidebar();
        return true;
      } catch (err) {
        handleApiFailure(err);
        return false;
      } finally {
        setBusy(false);
        focusScan();
      }
    });

  const onItemAction = (itemKey: string, targetState: string): Promise<boolean> =>
    runItemMutation((eid, aid) => submitItemAction(eid, aid, itemKey, targetState, deviceId));

  // Admin/superadmin only — resets a handed-out item back to "pending";
  // hits the admin-gated endpoint, which rejects non-admins regardless of
  // the button's visibility.
  const onRevokeItem = (itemKey: string): Promise<boolean> =>
    runItemMutation((eid, aid) => revokeItemState(eid, aid, itemKey));

  const onAddNote = (body: string) =>
    runExclusive(async () => {
      if (!eventId || !card || !canAct) return;
      setBusy(true);
      setTransportError(null);
      try {
        const { card: updated } = await submitAttendeeNote(eventId, card.id, body, deviceId);
        setCard(updated);
      } catch (err) {
        handleApiFailure(err);
        throw err;
      } finally {
        setBusy(false);
      }
    });

  // Queued alongside scans: the backend picks whichever check-in is
  // currently latest for this device at execution time (no specific id is
  // sent), so a scan admitting a new attendee while undo is in flight could
  // otherwise race ahead of it and get rolled back instead (#277 review).
  const onUndo = () =>
    runExclusive(async () => {
      if (!eventId || !canAct) return;
      setBusy(true);
      setTransportError(null);
      try {
        const { card: updated } = await undoLastCheckIn(eventId, deviceId);
        setCard(updated);
        setScanResult({ status: "PREVIEW", confirmed: false, card: updated });
        void refreshSidebar();
      } catch (err) {
        handleApiFailure(err);
      } finally {
        setBusy(false);
        focusScan();
      }
    });

  // Admin/superadmin only (canRevokeCheckIn) — reverses this attendee's
  // admission regardless of who checked them in or when, unlike onUndo's
  // device-scoped "last valid on this device" safety net. Reports transport
  // failures to the connection indicator but re-throws rather than calling
  // the full handleApiFailure — AttendeeCard's ConfirmDialog shows the error
  // inline instead of a page-level toast, matching the confirm-dialog
  // convention; only a duplicate toast is avoided, not the connection state.
  const onRevokeCheckIn = (attendeeId: string) =>
    runExclusive(async () => {
      if (!eventId) return;
      // Confirmation happens inside AttendeeCard's dialog, not on this
      // handler's own trigger button — canAct can flip false between
      // opening the dialog and clicking its Confirm, so this must throw
      // rather than silently resolve, or the dialog closes as if the
      // revoke succeeded when nothing was actually sent (bugbot).
      if (!canAct) throw new Error("Offline — check your connection and try again.");
      setBusy(true);
      try {
        const { card: updated } = await revokeAttendeeCheckIn(eventId, attendeeId);
        setCard(updated);
        setScanResult(scanResultFromCard(updated));
        void refreshSidebar();
        // Success only — AttendeeCard's dialog is still technically "open"
        // here (its own setRevokeOpen(false) runs after this promise
        // resolves), but useModalFocusTrap doesn't fight an external
        // .focus() call, so this lands cleanly right as the dialog closes.
        // On error the dialog stays open with an inline message; stealing
        // focus there would be wrong, so this must not run in `finally`.
        focusScan();
      } catch (err) {
        if (err instanceof ApiError) reportApiError(err.status);
        throw err;
      } finally {
        setBusy(false);
      }
    });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitOrLookup(buffer, wedgeIsBurstRef.current);
  };

  const handleBufferChange = (value: string, eventTimestamp: number) => {
    const justPasted = wedgeJustPastedRef.current;
    wedgeJustPastedRef.current = false;

    // Use the DOM event's own timestamp, not Date.now() at handler-execution
    // time: if the main thread is busy (e.g. a previous scan's response is
    // resolving and re-rendering) when a fast wedge character arrives, React
    // may not run this handler until after that work finishes — Date.now()
    // would then measure the app's own delay, not the gap between
    // keystrokes, and could permanently mark the rest of a genuine burst as
    // manual typing. event.timeStamp is captured when the browser dispatches
    // the input, independent of when a congested handler gets to it (#262 review).
    const now = eventTimestamp;
    // More than one new character appearing in a single change event is
    // never a real keystroke, no matter the source — drag-and-drop text,
    // browser autofill/autocomplete replacement, IME composition, voice
    // dictation, or anything else that doesn't fire an explicit paste event.
    // A genuine burst is only evidenced by characters arriving one at a time
    // in quick succession; an empty field jumping straight to a long value
    // in one shot is exactly the opposite of that evidence (#262 review).
    const lengthJump = value.length - buffer.length;
    if (justPasted || lengthJump > 1) {
      wedgeIsBurstRef.current = false;
    } else if (buffer.length === 0) {
      // Fresh input, exactly one new character — nothing to compare its
      // timing against yet, but this does look like a real single keystroke.
      wedgeIsBurstRef.current = true;
    } else if (now - wedgeLastCharAtRef.current > WEDGE_MAX_INTER_KEY_GAP_MS) {
      // A gap this long means a human is typing, not a hardware wedge —
      // length alone must not auto-submit this as a scan (#262).
      wedgeIsBurstRef.current = false;
    }
    wedgeLastCharAtRef.current = now;

    setBuffer(value);
    if (wedgeTimerRef.current != null) window.clearTimeout(wedgeTimerRef.current);

    if (value.length > WEDGE_AUTO_SUBMIT_LEN && wedgeIsBurstRef.current && canAct) {
      wedgeTimerRef.current = window.setTimeout(() => {
        void runScan(value);
      }, WEDGE_DEBOUNCE_MS);
    }

    // Live attendee suggestions under the scan bar. Only for human input:
    // a wedge burst never sees them (burst flag), and token-length values
    // route through the scan path above. Every change reschedules the timer,
    // so requests fire only after a typing pause.
    if (suggestTimerRef.current != null) window.clearTimeout(suggestTimerRef.current);
    const trimmed = value.trim();
    const canSuggest =
      allowManualLookup &&
      canAct &&
      !showMobileOverlay &&
      !wedgeIsBurstRef.current &&
      trimmed.length >= 2 &&
      trimmed.length < WEDGE_AUTO_SUBMIT_LEN;
    if (canSuggest) {
      suggestTimerRef.current = window.setTimeout(() => {
        void fetchSuggestions(trimmed);
      }, SUGGEST_DEBOUNCE_MS);
    } else {
      suggestSeqRef.current += 1;
      setSuggestions([]);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (showInlineCamera) return;
      resetScan();
      if (cameraActive) setCameraActive(false);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void submitOrLookup(buffer, wedgeIsBurstRef.current);
    }
  };

  if (!eventId) {
    return (
      <Card>
        <p className="placeholder-note">Open an event check-in route to start scanning.</p>
      </Card>
    );
  }

  const showUndo =
    !!deviceLabel &&
    scanResult?.status === "VALID" &&
    scanResult.confirmed &&
    card?.check_in_status === "admitted";

  const showResultCard =
    card &&
    scanResult &&
    (scanResult.status === "PREVIEW" ||
      scanResult.status === "VALID" ||
      scanResult.status === "ALREADY_CHECKED_IN" ||
      scanResult.status === "REVOKED");

  const showCompactFeedback =
    scanResult &&
    (!card || scanResult.status === "INVALID");

  return (
    <>
      <CheckinConnectionLiveRegion />
      <CheckinConnectionBanner />

      {/* The SSE live-updates feed and the app-wide heartbeat are two
          independent connections (#458) — when both drop together (the
          common case, e.g. a backend restart), CheckinConnectionBanner
          above already covers it, so these only add value when the stream
          has a problem of its own while the heartbeat is otherwise healthy.
          `!canAct` used to get its own duplicate "blocked" paragraph here
          too; canMutateCheckin is driven by the exact same connectionState
          the banner above already reflects, so it was announcing the same
          thing twice in different styling. */}
      {connectionState === "connected" && streamStatus === "auth_error" && (
        <p className="check-in__offline-banner" role="status">
          Live updates unavailable — check access
        </p>
      )}
      {connectionState === "connected" && streamStatus === "reconnecting" && (
        <p className="check-in__offline-banner" role="status">
          Reconnecting live updates…
        </p>
      )}

      {isOperatorShell && (isDesktop || !cameraActive) && (
        <div className="ck-operator-actions" ref={operatorCameraActionsRef}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<i className={`ti ti-camera${cameraActive ? "-off" : ""}`} aria-hidden="true" />}
            onClick={() => setCameraActive(!cameraActive)}
          >
            {cameraActive ? "Disable camera" : "Use camera"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-pressed={scanSoundMuted}
            aria-label={scanSoundMuteLabel(scanSoundMuted)}
            title={scanSoundMuteTitle(scanSoundMuted)}
            icon={<i className={scanSoundMuteIconClass(scanSoundMuted)} aria-hidden="true" />}
            onClick={toggleScanSoundMuted}
          />
        </div>
      )}

      <div className="ck-layout">
        <div className="ck-main">
          <div className="ck-scan-wrap">
            <form className="ck-scan-bar" onSubmit={onSubmit} autoComplete="off">
              <i className="ti ti-scan ck-scan-bar__icon" aria-hidden="true" />
              <input
                ref={inputRef}
                id="checkin-scan-field"
                name="checkin-scan"
                className="ck-scan-bar__input"
                value={buffer}
                onChange={(e) => handleBufferChange(e.target.value, e.timeStamp)}
                onPaste={() => {
                  wedgeJustPastedRef.current = true;
                }}
                onKeyDown={onKeyDown}
                autoFocus
                inputMode="none"
                placeholder="Scan QR · type name or email…"
                aria-label="QR scan or search"
                aria-describedby="ck-scan-hint"
                disabled={!canAct}
                aria-busy={busy}
                {...checkinSearchFieldAttrs}
              />
              <button
                type="submit"
                className="ck-scan-bar__submit"
                aria-label="Search"
                disabled={busy || !buffer.trim() || !canAct}
              >
                <i className="ti ti-arrow-right" aria-hidden="true" />
              </button>
            </form>
            {suggestions.length > 0 && !showMobileOverlay && (
              <ul className="ck-suggest" aria-label="Attendee suggestions">
                {suggestions.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="ck-suggest__hit"
                      disabled={busy}
                      onClick={() => void openLookupResult(r.id)}
                    >
                      <span className="ck-suggest__info">
                        <strong className="ck-suggest__name">{r.name}</strong>
                        <span className="ck-suggest__meta">
                          {[r.company, r.ticket_type].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </span>
                      {r.check_in_status === "admitted" && (
                        <span className="ck-suggest__in">
                          <i className="ti ti-circle-check" aria-hidden="true" /> checked in
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p id="ck-scan-hint" className="ck-hint">
            Scan a code — it submits itself · type a name, then press Enter · Esc clears the field
          </p>

          {/* Suppressed while the mobile overlay is open: the overlay renders
              its own role="alert" copy of this same message (it's a fixed
              full-screen layer covering this paragraph), so without this gate a
              screen reader would announce the identical error twice (review
              finding). Exactly one of the two is mounted at any time. */}
          {transportError && !showMobileOverlay && (
            <p className="checkin-surface__transport-error" role="alert">
              {transportError}
            </p>
          )}

          {showInlineCamera ? (
            <>
              {!showResultCard && (
                <CkInlineCamera
                  wedgeActive={buffer.trim().length > 0}
                  scannerPaused={!!scanResult || pending}
                  overlayScanResult={showCompactFeedback ? scanResult : null}
                  onScan={(raw) => void runScan(raw)}
                  onClose={closeInlineCamera}
                  onReset={resetScan}
                />
              )}
              {showResultCard && card && (
                <AttendeeCard
                  key={card.id}
                  card={card}
                  eventTimezone={eventTimezone}
                  scanStatus={scanResult?.status}
                  confirmed={scanResult?.confirmed}
                  pending={pending}
                  canAct={canAct && !busy}
                  onCheckIn={
                    card.check_in_status === "not_admitted"
                      ? () => void admitCurrent(card.id, admitOrigin)
                      : undefined
                  }
                  onItemAction={onItemAction}
                  onAddNote={onAddNote}
                  onUndo={onUndo}
                  showUndo={showUndo}
                  onCancel={resetScan}
                  onRevokeCheckIn={
                    canRevokeCheckIn ? () => onRevokeCheckIn(card.id) : undefined
                  }
                  onRevokeItem={canRevokeCheckIn ? onRevokeItem : undefined}
                />
              )}
            </>
          ) : (
            <>
              {showCompactFeedback && scanResult && (
                <ScanFeedback result={scanResult} hidden={false} />
              )}

              {showResultCard && card ? (
                <AttendeeCard
                  key={card.id}
                  card={card}
                  eventTimezone={eventTimezone}
                  scanStatus={scanResult?.status}
                  confirmed={scanResult?.confirmed}
                  pending={pending}
                  canAct={canAct && !busy}
                  onCheckIn={
                    card.check_in_status === "not_admitted"
                      ? () => void admitCurrent(card.id, admitOrigin)
                      : undefined
                  }
                  onItemAction={onItemAction}
                  onAddNote={onAddNote}
                  onUndo={onUndo}
                  showUndo={showUndo}
                  onCancel={resetScan}
                  onRevokeCheckIn={
                    canRevokeCheckIn ? () => onRevokeCheckIn(card.id) : undefined
                  }
                  onRevokeItem={canRevokeCheckIn ? onRevokeItem : undefined}
                />
              ) : (
                !scanResult && <CkEmptyState />
              )}
            </>
          )}
        </div>

        <aside className="ck-side">
          <Card>
            <ScanHistoryList
              admittedCount={admittedCount}
              totalCount={totalCount}
              history={history}
              eventTimezone={eventTimezone}
              eventDate={eventDate}
              onSelectAttendee={openLookupResult}
            />
          </Card>
        </aside>
      </div>

      {showMobileOverlay && (
        <CameraOverlay
          open
          eventTimezone={eventTimezone}
          eventDate={eventDate}
          admittedCount={admittedCount}
          history={history}
          wedgeActive={buffer.trim().length > 0}
          onClose={() => setCameraActive(false)}
          onScan={(raw) => void runScan(raw)}
          allowManualLookup={allowManualLookup}
          onSearch={(query) => lookupCheckInAttendees(eventId, query)}
          onSelectAttendee={openLookupResult}
          onManualEntry={submitOrLookup}
          manualError={overlayManualError}
          onClearManualError={() => setOverlayManualError(null)}
          scanResult={scanResult}
          card={card}
          pending={pending}
          canAct={canAct && !busy}
          onConfirm={
            card && scanResult?.status === "PREVIEW"
              ? () => void admitCurrent(card.id, admitOrigin)
              : undefined
          }
          onReset={resetScan}
          onItemAction={onItemAction}
          onUndo={onUndo}
          showUndo={showUndo}
          transportError={transportError}
        />
      )}
    </>
  );
}
