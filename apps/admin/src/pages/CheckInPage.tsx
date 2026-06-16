import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useParams } from "react-router-dom";
import { Card, PageHeader, StatusBadge } from "@admitto/ui";
import { ApiError, submitCheckInScan } from "../api/client.js";
import type { CheckInScanResponse } from "../api/types.js";
import { useAuth } from "../auth/AuthProvider.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { CHECKIN_DUPLICATE_DEBOUNCE_MS, normalizeScannedInput } from "../checkin/normalize.js";

function formatAdmittedAt(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function CheckInPage() {
  const { eventId } = useParams();
  const { deviceLabel } = useAuth();
  const { reportApiError } = useConnectionState();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);

  const [buffer, setBuffer] = useState("");
  const [busy, setBusy] = useState(false);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckInScanResponse | null>(null);

  const focusScan = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    focusScan();
  }, [focusScan, eventId]);

  const runScan = useCallback(
    async (raw: string) => {
      if (!eventId) return;
      const scanned = normalizeScannedInput(raw);
      if (!scanned) return;

      const now = Date.now();
      const last = lastScanRef.current;
      if (last && last.value === scanned && now - last.at < CHECKIN_DUPLICATE_DEBOUNCE_MS) {
        return;
      }
      lastScanRef.current = { value: scanned, at: now };

      setBusy(true);
      setTransportError(null);
      try {
        const response = await submitCheckInScan(eventId, scanned, deviceLabel ?? undefined);
        setResult(response);
        setBuffer("");
      } catch (err) {
        setResult(null);
        if (err instanceof ApiError) {
          reportApiError(err.status);
          setTransportError(
            err.status === 401
              ? "Session expired — sign in again."
              : "Check-in request failed. Try again.",
          );
        } else {
          setTransportError("Check-in request failed. Try again.");
        }
      } finally {
        setBusy(false);
        focusScan();
      }
    },
    [deviceLabel, eventId, focusScan, reportApiError],
  );

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

  return (
    <div className="checkin-surface">
      <PageHeader
        title="Check-in"
        subtitle="Scan a guest QR or barcode. Camera is not used — wedge or keyboard input only."
      />

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
              disabled={busy}
              aria-busy={busy}
              aria-describedby="checkin-scan-hint"
            />
            <span id="checkin-scan-hint" className="at-hint">
              Autofocused for handheld scanners. Press Enter to submit.
            </span>
          </div>
          <button type="submit" className="checkin-surface__submit" disabled={busy || !buffer.trim()}>
            {busy ? "Checking…" : "Submit scan"}
          </button>
        </form>
      </Card>

      {transportError && (
        <p className="checkin-surface__transport-error" role="alert">
          {transportError}
        </p>
      )}

      {result && (
        <Card
          className={`checkin-surface__result checkin-surface__result--${result.status.toLowerCase()}`}
          aria-live="polite"
        >
          <div className="checkin-surface__result-header">
            <StatusBadge status={result.status} />
            {result.attendee?.ticket_type && (
              <span className="checkin-surface__ticket-type">{result.attendee.ticket_type}</span>
            )}
          </div>
          {result.attendee ? (
            <p className="checkin-surface__guest-name">{result.attendee.name}</p>
          ) : (
            <p className="checkin-surface__guest-name checkin-surface__guest-name--muted">Unknown guest</p>
          )}
          {formatAdmittedAt(result.admittedAt) && (
            <p className="checkin-surface__meta">Admitted at {formatAdmittedAt(result.admittedAt)}</p>
          )}
        </Card>
      )}
    </div>
  );
}
