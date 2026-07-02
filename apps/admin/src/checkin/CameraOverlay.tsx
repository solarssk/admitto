import { useCallback, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Button } from "@admitto/ui";
import type {
  AttendeeCardDto,
  CheckInHistoryEntry,
  CheckInScanResponse,
} from "../api/types.js";
import { CameraScanner } from "./CameraScanner.js";
import { CheckInCameraResultPanel } from "./CheckInCameraResultPanel.js";
import { CkRecentScans } from "./CkRecentScans.js";
import { checkinSearchFieldAttrs } from "./searchFieldAttrs.js";

type CameraOverlayProps = {
  open: boolean;
  eventTitle: string;
  eventTimezone: string;
  admittedCount: number;
  history: CheckInHistoryEntry[];
  wedgeActive: boolean;
  onClose: () => void;
  onScan: (raw: string) => void;
  onManualEntry: (query: string) => Promise<boolean>;
  manualError?: string | null;
  onClearManualError?: () => void;
  scanResult: CheckInScanResponse | null;
  card: AttendeeCardDto | null;
  pending: boolean;
  canAct: boolean;
  onConfirm?: () => void;
  onReset: () => void;
};

export function CameraOverlay({
  open,
  eventTitle,
  eventTimezone,
  admittedCount,
  history,
  wedgeActive,
  onClose,
  onScan,
  onManualEntry,
  manualError,
  onClearManualError,
  scanResult,
  card,
  pending,
  canAct,
  onConfirm,
  onReset,
}: CameraOverlayProps) {
  const [manualMode, setManualMode] = useState(false);
  const [manualToken, setManualToken] = useState("");

  useEffect(() => {
    if (!open) {
      setManualMode(false);
      setManualToken("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submitManual = useCallback(async () => {
    const raw = manualToken.trim();
    if (!raw || !canAct || pending) return;
    const ok = await onManualEntry(raw);
    if (!ok) return;
    setManualToken("");
    setManualMode(false);
  }, [canAct, manualToken, onManualEntry, pending]);

  const onManualKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitManual();
    }
  };

  if (!open) return null;

  return (
    <div className="ck-overlay" role="dialog" aria-modal="true" aria-label="Camera check-in">
      <header className="ck-overlay__bar">
        <div className="ck-overlay__brand">
          <span className="ck-overlay__brand-mark" aria-hidden="true" />
          <span>Check-in · {eventTitle}</span>
        </div>
        <span className="ck-overlay__admitted">{admittedCount} checked in</span>
        <button
          type="button"
          className="ck-overlay__close"
          aria-label="Exit camera mode"
          onClick={onClose}
        >
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      </header>

      <div className="ck-overlay__body">
        <div className="ck-overlay__main">
          <CameraScanner
            enabled={!scanResult && !pending}
            wedgeActive={wedgeActive}
            onScan={onScan}
          />
          {scanResult ? (
            <CheckInCameraResultPanel
              scanResult={scanResult}
              card={card}
              pending={pending}
              canAct={canAct}
              eventTimezone={eventTimezone}
              onConfirm={onConfirm}
              onReset={onReset}
            />
          ) : (
            <div className="ck-overlay__viewfinder" aria-hidden="true">
              <div className="vf-frame">
                <span className="c tl" />
                <span className="c tr" />
                <span className="c bl" />
                <span className="c br" />
                <span className="vf-line" />
              </div>
              <p className="ck-overlay__hint">Point the camera at the attendee&apos;s QR</p>
            </div>
          )}
        </div>

        <aside className="ck-overlay__aside">
          <CkRecentScans history={history} eventTimezone={eventTimezone} compact limit={6} />
        </aside>
      </div>

      <div className="ck-overlay__manual">
        {manualMode ? (
          <div className="ck-overlay__manual-form">
            <input
              type="text"
              className="ck-overlay__manual-input"
              name="checkin-overlay-search"
              value={manualToken}
              onChange={(e) => {
                setManualToken(e.target.value);
                if (manualError) onClearManualError?.();
              }}
              onKeyDown={onManualKeyDown}
              placeholder="Paste token or search by name, email…"
              aria-label="Enter token or search by name"
              aria-invalid={manualError ? true : undefined}
              aria-describedby={manualError ? "ck-overlay-manual-error" : undefined}
              {...checkinSearchFieldAttrs}
            />
            {manualError && (
              <p id="ck-overlay-manual-error" className="ck-overlay__manual-error" role="alert">
                {manualError}
              </p>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canAct || pending}
              onClick={submitManual}
            >
              Submit
            </Button>
            <button type="button" className="link-btn" onClick={() => setManualMode(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setManualMode(true);
              onClearManualError?.();
            }}
          >
            ⌨ Enter token or search by name, email
          </button>
        )}
      </div>
    </div>
  );
}
