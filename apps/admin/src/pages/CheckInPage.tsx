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
} from "../api/client.js";
import type { AttendeeCardDto, CheckInHistoryEntry, CheckInScanResponse, OpsConfigDto } from "../api/types.js";
import { useAuth } from "../auth/AuthProvider.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { CHECKIN_DUPLICATE_DEBOUNCE_MS, normalizeScannedInput } from "../checkin/normalize.js";
import { canMutateCheckin } from "../checkin/connection.js";
import { ScanFeedback } from "../checkin/ScanFeedback.js";
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
import { ManualLookupPanel } from "../checkin/ManualLookupPanel.js";
import { checkinSearchFieldAttrs } from "../checkin/searchFieldAttrs.js";
import { ScanHistoryList } from "../checkin/ScanHistoryList.js";

const PENDING_MS = 5000;
const WEDGE_AUTO_SUBMIT_LEN = 20;
const WEDGE_DEBOUNCE_MS = 50;
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
  useCamera?: boolean;
  onUseCameraChange?: (open: boolean) => void;
}

export function CheckInPage({
  eventTitle = "Event",
  eventTimezone: eventTimezoneProp,
  useCamera = false,
  onUseCameraChange,
}: CheckInPageProps) {
  const { eventId } = useParams();
  const [eventTimezone, setEventTimezone] = useState(eventTimezoneProp ?? "UTC");
  const { deviceLabel } = useAuth();
  const { state: connectionState, reportApiError } = useConnectionState();
  const { addToast } = useToast();
  const canAct = canMutateCheckin(connectionState);
  const isOperatorShell = onUseCameraChange === undefined;
  const isDesktop = useIsDesktop();
  const [operatorCamera, setOperatorCamera] = useState(() => !isDesktopViewport());
  const cameraActive = isOperatorShell ? operatorCamera : useCamera;
  const showMobileOverlay = cameraActive && !isDesktop;
  const showInlineCamera = cameraActive && isDesktop;

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
  const recentAdmits = useRef(new Map<string, number>());
  const historyRef = useRef<CheckInHistoryEntry[]>([]);

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
  const [lookupQ, setLookupQ] = useState("");
  const [lookupResults, setLookupResults] = useState<Awaited<ReturnType<typeof lookupCheckInAttendees>>>([]);
  const [history, setHistory] = useState<CheckInHistoryEntry[]>([]);
  historyRef.current = history;
  const [admittedCount, setAdmittedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [admitOrigin, setAdmitOrigin] = useState<"scan" | "manual">("manual");
  const [overlayManualError, setOverlayManualError] = useState<string | null>(null);
  const [opsConfig, setOpsConfig] = useState<OpsConfigDto>(DEFAULT_OPS_CONFIG);

  const deviceId = deviceLabel ?? undefined;
  const allowManualLookup = opsConfig.allow_manual_lookup;
  const autoAdvanceOnValid = opsConfig.auto_advance_on_valid;

  useEffect(() => {
    if (eventTimezoneProp) {
      setEventTimezone(eventTimezoneProp);
      return;
    }
    if (!eventId) return;
    let cancelled = false;
    fetchCheckInEvents()
      .then((events) => {
        const found = events.find((e) => e.id === eventId);
        if (!cancelled) setEventTimezone(found?.timezone ?? "UTC");
      })
      .catch(() => {
        if (!cancelled) setEventTimezone("UTC");
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, eventTimezoneProp]);

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

  const applyResponse = (response: CheckInScanResponse) => {
    setScanResult(response);
    if (response.card) {
      setCard(response.card);
    } else if (response.status === "INVALID") {
      setCard(null);
    }
  };

  const resetScan = useCallback(() => {
    if (wedgeTimerRef.current != null) {
      window.clearTimeout(wedgeTimerRef.current);
      wedgeTimerRef.current = null;
    }
    setScanResult(null);
    setCard(null);
    setTransportError(null);
    setOverlayManualError(null);
    setBuffer("");
    focusScan();
  }, [focusScan]);

  const maybeAutoAdvance = useCallback(
    (response: CheckInScanResponse) => {
      if (autoAdvanceOnValid && response.status === "VALID" && response.confirmed) {
        resetScan();
      }
    },
    [autoAdvanceOnValid, resetScan],
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
          : err.message || "Request failed.",
      );
    } else {
      setTransportError("Request failed. Try again.");
    }
  };

  const runScan = useCallback(
    async (raw: string) => {
      if (!eventId || !canAct) return;
      const scanned = normalizeScannedInput(raw);
      if (!scanned) return;

      const now = Date.now();
      const last = lastScanRef.current;
      if (last && last.value === scanned && now - last.at < CHECKIN_DUPLICATE_DEBOUNCE_MS) {
        setBuffer("");
        focusScan();
        return;
      }
      lastScanRef.current = { value: scanned, at: now };

      setBusy(true);
      setTransportError(null);
      try {
        const response = await runWithPending(() => submitCheckInScan(eventId, scanned, deviceId));
        if (!response) return;
        applyResponse(response);
        maybeAutoAdvance(response);
        setAdmitOrigin("scan");
        if (response.status === "PREVIEW" && response.attendeeId && !response.card) {
          const loaded = await fetchAttendeeCard(eventId, response.attendeeId);
          setCard(loaded);
        }
        setBuffer("");
        if (response.status === "VALID" && response.admittedAt) {
          applyLocalAdmit(response);
          void refreshStatsOnly();
        } else {
          void refreshSidebar();
        }
      } catch (err) {
        setScanResult(null);
        handleApiFailure(err);
      } finally {
        setBusy(false);
        focusScan();
      }
    },
    [canAct, deviceId, eventId, focusScan, maybeAutoAdvance, applyLocalAdmit, refreshSidebar, refreshStatsOnly, reportApiError],
  );

  const closeInlineCamera = useCallback(() => {
    returnFocusUseCameraRef.current = isOperatorShell;
    setCameraActive(false);
    if (!isOperatorShell) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOperatorShell, setCameraActive]);

  const admitCurrent = async (attendeeId: string, method: "scan" | "manual" = "manual") => {
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
  };

  const openLookupResult = async (attendeeId: string) => {
    if (!eventId) return;
    setBusy(true);
    try {
      const loaded = await fetchAttendeeCard(eventId, attendeeId);
      setCard(loaded);
      setScanResult({ status: "PREVIEW", confirmed: false, card: loaded, attendeeId });
      setAdmitOrigin("manual");
      setManualOpen(false);
    } catch (err) {
      handleApiFailure(err);
    } finally {
      setBusy(false);
      focusScan();
    }
  };

  const runLookup = async () => {
    if (!eventId || !canAct || !lookupQ.trim()) return;
    if (!allowManualLookup) {
      setTransportError(LOOKUP_DISABLED_MSG);
      return;
    }
    setBusy(true);
    try {
      const results = await lookupCheckInAttendees(eventId, lookupQ);
      setLookupResults(results);
      if (results.length === 0) {
        addToast(LOOKUP_NO_MATCH_MSG, "warning");
      }
    } catch (err) {
      handleApiFailure(err);
    } finally {
      setBusy(false);
    }
  };

  const submitScanOrLookup = useCallback(
    async (query: string): Promise<boolean> => {
      const trimmed = query.trim();
      if (!trimmed) return false;

      if (trimmed.length >= WEDGE_AUTO_SUBMIT_LEN) {
        void runScan(trimmed);
        return true;
      }

      if (!eventId || !canAct) return false;

      if (!allowManualLookup) {
        const message = LOOKUP_DISABLED_MSG;
        if (showMobileOverlay) setOverlayManualError(message);
        else setTransportError(message);
        return false;
      }

      setBusy(true);
      setTransportError(null);
      setOverlayManualError(null);
      try {
        const results = await lookupCheckInAttendees(eventId, trimmed);
        if (results.length === 1) {
          await openLookupResult(results[0].id);
          setBuffer("");
          return true;
        }
        if (results.length === 0) {
          if (showMobileOverlay) setOverlayManualError(LOOKUP_NO_MATCH_MSG);
          else addToast(LOOKUP_NO_MATCH_MSG, "warning");
        } else {
          const message = "Multiple matches — narrow your search or use manual lookup.";
          if (showMobileOverlay) setOverlayManualError(message);
          else setTransportError(message);
        }
        return false;
      } catch (err) {
        if (err instanceof ApiError) {
          reportApiError(err.status);
          const message =
            err.status === 401
              ? "Session expired — sign in again."
              : err.message || "Request failed.";
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
    [allowManualLookup, addToast, canAct, eventId, reportApiError, runScan, showMobileOverlay],
  );

  const onItemAction = async (itemKey: string, targetState: string) => {
    if (!eventId || !card || !canAct) return;
    setBusy(true);
    try {
      const { card: updated } = await submitItemAction(eventId, card.id, itemKey, targetState, deviceId);
      setCard(updated);
      void refreshSidebar();
    } catch (err) {
      handleApiFailure(err);
    } finally {
      setBusy(false);
      focusScan();
    }
  };

  const onAddNote = async (body: string) => {
    if (!eventId || !card || !canAct) return;
    setBusy(true);
    try {
      const { card: updated } = await submitAttendeeNote(eventId, card.id, body, deviceId);
      setCard(updated);
    } catch (err) {
      handleApiFailure(err);
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const onUndo = async () => {
    if (!eventId || !canAct) return;
    setBusy(true);
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
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitScanOrLookup(buffer);
  };

  const handleBufferChange = (value: string) => {
    if (value.includes("\r") || value.includes("\n")) {
      const cleaned = value.replace(/[\r\n]+/g, "").trim();
      setBuffer("");
      if (cleaned && canAct) void submitScanOrLookup(cleaned);
      return;
    }

    setBuffer(value);
    if (wedgeTimerRef.current != null) window.clearTimeout(wedgeTimerRef.current);

    if (value.length > WEDGE_AUTO_SUBMIT_LEN && canAct) {
      wedgeTimerRef.current = window.setTimeout(() => {
        void runScan(value);
      }, WEDGE_DEBOUNCE_MS);
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
      void submitScanOrLookup(buffer);
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
      scanResult.status === "ALREADY_CHECKED_IN");

  const showCompactFeedback =
    scanResult &&
    (!card ||
      scanResult.status === "INVALID" ||
      scanResult.status === "REVOKED");

  return (
    <>
      {!isOperatorShell && <CheckinConnectionLiveRegion />}
      {!isOperatorShell && <CheckinConnectionBanner />}

      {streamStatus === "auth_error" && (
        <p className="check-in__offline-banner" role="status">
          Live updates unavailable — check access
        </p>
      )}
      {streamStatus === "reconnecting" && (
        <p className="check-in__offline-banner" role="status">
          Reconnecting live updates…
        </p>
      )}

      {!canAct && (
        <p className="checkin-surface__transport-error" role="status">
          Not connected — new check-ins and actions are blocked until the server responds.
        </p>
      )}

      {isOperatorShell && !cameraActive && (
        <div className="ck-operator-actions" ref={operatorCameraActionsRef}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<i className="ti ti-camera" aria-hidden="true" />}
            onClick={() => setCameraActive(true)}
          >
            Use camera
          </Button>
        </div>
      )}

      <div className="ck-layout">
        <div className="ck-main">
          <form className="ck-scan-bar" onSubmit={onSubmit} autoComplete="off">
            <i className="ti ti-scan ck-scan-bar__icon" aria-hidden="true" />
            <input
              ref={inputRef}
              id="checkin-scan-field"
              name="checkin-scan"
              className="ck-scan-bar__input"
              value={buffer}
              onChange={(e) => handleBufferChange(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
              inputMode="none"
              placeholder="Scan QR · type name, email or company…"
              aria-label="QR scan or search"
              aria-describedby="ck-scan-hint"
              disabled={busy || !canAct}
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
          <p id="ck-scan-hint" className="ck-hint">
            Keyboard wedge auto-submits · Enter to confirm · Esc to clear
          </p>

          {transportError && (
            <p className="checkin-surface__transport-error" role="alert">
              {transportError}
            </p>
          )}

          {showInlineCamera ? (
            <>
              <CkInlineCamera
                wedgeActive={buffer.trim().length > 0}
                scannerPaused={!!scanResult || pending}
                overlayScanResult={showCompactFeedback ? scanResult : null}
                onScan={(raw) => void runScan(raw)}
                onClose={closeInlineCamera}
                card={card}
                pending={pending}
                canAct={canAct && !busy}
                eventTimezone={eventTimezone}
                onConfirm={
                  showCompactFeedback &&
                  card &&
                  scanResult?.status === "PREVIEW"
                    ? () => void admitCurrent(card.id, admitOrigin)
                    : undefined
                }
                onReset={resetScan}
              />
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
                  onItemAction={(key: string, state: string) => void onItemAction(key, state)}
                  onAddNote={onAddNote}
                  onUndo={() => void onUndo()}
                  showUndo={showUndo}
                  onCancel={resetScan}
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
                  onItemAction={(key: string, state: string) => void onItemAction(key, state)}
                  onAddNote={onAddNote}
                  onUndo={() => void onUndo()}
                  showUndo={showUndo}
                  onCancel={resetScan}
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
            />
            {allowManualLookup ? (
              <ManualLookupPanel
                open={manualOpen}
                query={lookupQ}
                results={lookupResults}
                busy={busy}
                canAct={canAct}
                onToggle={() => setManualOpen((v) => !v)}
                onQueryChange={setLookupQ}
                onSearch={() => void runLookup()}
                onSelect={(id) => void openLookupResult(id)}
              />
            ) : null}
          </Card>
        </aside>
      </div>

      {showMobileOverlay && (
        <CameraOverlay
          open
          eventTitle={eventTitle}
          eventTimezone={eventTimezone}
          admittedCount={admittedCount}
          history={history}
          wedgeActive={buffer.trim().length > 0}
          onClose={() => setCameraActive(false)}
          onScan={(raw) => void runScan(raw)}
          onManualEntry={submitScanOrLookup}
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
        />
      )}
    </>
  );
}
