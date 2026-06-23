import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useParams } from "react-router-dom";
import { Card, PageHeader } from "@admitto/ui";
import {
  ApiError,
  fetchAttendeeCard,
  fetchCheckInHistory,
  fetchCheckInStats,
  lookupCheckInAttendees,
  submitAttendeeNote,
  submitCheckInAdmit,
  submitCheckInScan,
  submitItemAction,
  undoLastCheckIn,
} from "../api/client.js";
import type { AttendeeCardDto, CheckInHistoryEntry, CheckInScanResponse } from "../api/types.js";
import { useAuth } from "../auth/AuthProvider.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { CHECKIN_DUPLICATE_DEBOUNCE_MS, normalizeScannedInput } from "../checkin/normalize.js";
import { canMutateCheckin } from "../checkin/connection.js";
import { AttendeeCard } from "../checkin/AttendeeCard.js";
import { CameraScanner } from "../checkin/CameraScanner.js";
import { ManualLookupPanel } from "../checkin/ManualLookupPanel.js";
import { ScanHistoryList } from "../checkin/ScanHistoryList.js";

const PENDING_MS = 5000;

export function CheckInPage() {
  const { eventId } = useParams();
  const { deviceLabel } = useAuth();
  const { state: connectionState, reportApiError } = useConnectionState();
  const canAct = canMutateCheckin(connectionState);

  const inputRef = useRef<HTMLInputElement>(null);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const pendingTimerRef = useRef<number | null>(null);

  const [buffer, setBuffer] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<CheckInScanResponse | null>(null);
  const [card, setCard] = useState<AttendeeCardDto | null>(null);
  const [lookupQ, setLookupQ] = useState("");
  const [lookupResults, setLookupResults] = useState<Awaited<ReturnType<typeof lookupCheckInAttendees>>>([]);
  const [history, setHistory] = useState<CheckInHistoryEntry[]>([]);
  const [admittedCount, setAdmittedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [useCamera, setUseCamera] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [admitOrigin, setAdmitOrigin] = useState<"scan" | "manual">("manual");

  const deviceId = deviceLabel ?? undefined;

  const focusScan = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const refreshSidebar = useCallback(async () => {
    if (!eventId) return;
    try {
      const [h, stats] = await Promise.all([
        fetchCheckInHistory(eventId, 8),
        fetchCheckInStats(eventId),
      ]);
      setHistory(h);
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
        setAdmitOrigin("scan");
        if (response.status === "PREVIEW" && response.attendeeId && !response.card) {
          const loaded = await fetchAttendeeCard(eventId, response.attendeeId);
          setCard(loaded);
        }
        setBuffer("");
        void refreshSidebar();
      } catch (err) {
        setScanResult(null);
        handleApiFailure(err);
      } finally {
        setBusy(false);
        focusScan();
      }
    },
    [canAct, deviceId, eventId, focusScan, refreshSidebar, reportApiError],
  );

  const admitCurrent = async (attendeeId: string, method: "scan" | "manual" = "manual") => {
    if (!eventId || !canAct) return;
    setBusy(true);
    setTransportError(null);
    try {
      const response = await runWithPending(() =>
        submitCheckInAdmit(eventId, attendeeId, deviceId, method),
      );
      if (response) applyResponse(response);
      void refreshSidebar();
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
    setBusy(true);
    try {
      const results = await lookupCheckInAttendees(eventId, lookupQ);
      setLookupResults(results);
    } catch (err) {
      handleApiFailure(err);
    } finally {
      setBusy(false);
    }
  };

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
    void runScan(buffer);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void runScan(buffer);
    }
  };

  if (!eventId) {
    return (
      <Card>
        <PageHeader title="Check-in" subtitle="Open an event check-in route to start scanning." />
      </Card>
    );
  }

  const showUndo =
    !!deviceLabel &&
    scanResult?.status === "VALID" &&
    scanResult.confirmed &&
    card?.check_in_status === "admitted";

  return (
    <div className="checkin-surface checkin-surface--split">
      <div className="checkin-surface__main">
        <PageHeader
          title="Check-in"
          subtitle="Scan QR or search manually. Camera is opt-in only."
        />

        {!canAct && (
          <p className="checkin-surface__transport-error" role="status">
            Not connected — new check-ins and actions are blocked until the server responds.
          </p>
        )}

        <Card className="checkin-surface__scan-card">
          <form className="checkin-surface__form" onSubmit={onSubmit}>
            <div className="at-field">
              <label className="at-label" htmlFor="checkin-scan-field">
                Scan field
              </label>
              <input
                ref={inputRef}
                id="checkin-scan-field"
                className="at-input checkin-surface__input"
                value={buffer}
                onChange={(e) => setBuffer(e.target.value)}
                onKeyDown={onKeyDown}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={busy || !canAct}
                aria-busy={busy}
              />
              <span className="at-hint">Wedge / keyboard input. Refocuses after each scan.</span>
            </div>
            <button
              type="submit"
              className="checkin-surface__submit"
              disabled={busy || !buffer.trim() || !canAct}
            >
              {busy ? "Working…" : "Submit scan"}
            </button>
          </form>

          <label className="checkin-surface__camera-toggle">
            <input
              type="checkbox"
              checked={useCamera}
              onChange={(e) => setUseCamera(e.target.checked)}
            />
            Use camera to scan (opt-in)
          </label>
          <CameraScanner
            enabled={useCamera}
            wedgeActive={buffer.trim().length > 0}
            onScan={(raw) => void runScan(raw)}
          />
        </Card>

        {transportError && (
          <p className="checkin-surface__transport-error" role="alert">
            {transportError}
          </p>
        )}

        {card && (
          <AttendeeCard
            key={card.id}
            card={card}
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
          />
        )}
      </div>

      <aside className="checkin-surface__aside">
        <Card>
          <ScanHistoryList admittedCount={admittedCount} totalCount={totalCount} history={history} />
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
        </Card>
      </aside>
    </div>
  );
}
