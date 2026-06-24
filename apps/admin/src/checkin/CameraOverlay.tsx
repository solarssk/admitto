import { useCallback, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Button } from "@admitto/ui";
import type {
  AttendeeCardDto,
  CheckInHistoryEntry,
  CheckInScanResponse,
  CheckInStatus,
} from "../api/types.js";
import { CameraScanner } from "./CameraScanner.js";
import { CkRecentScans } from "./CkRecentScans.js";

type CameraOverlayProps = {
  open: boolean;
  eventTitle: string;
  admittedCount: number;
  history: CheckInHistoryEntry[];
  wedgeActive: boolean;
  onClose: () => void;
  onScan: (raw: string) => void;
  scanResult: CheckInScanResponse | null;
  card: AttendeeCardDto | null;
  pending: boolean;
  canAct: boolean;
  onConfirm?: () => void;
  onReset: () => void;
};

function statusMeta(status: CheckInStatus): {
  icon: string;
  title: string;
  subtitle: string;
  tone: "ok" | "warn" | "error" | "info";
} {
  switch (status) {
    case "VALID":
      return {
        icon: "ti-circle-check",
        title: "Valid",
        subtitle: "Check-in recorded",
        tone: "ok",
      };
    case "ALREADY_CHECKED_IN":
      return {
        icon: "ti-clock-exclamation",
        title: "Already checked in",
        subtitle: "Entered earlier today",
        tone: "warn",
      };
    case "INVALID":
      return {
        icon: "ti-circle-x",
        title: "Invalid ticket",
        subtitle: "Code not valid for this event",
        tone: "error",
      };
    case "REVOKED":
      return {
        icon: "ti-ban",
        title: "Revoked",
        subtitle: "Ticket cancelled or revoked",
        tone: "error",
      };
    case "PREVIEW":
    default:
      return {
        icon: "ti-circle-check",
        title: "Valid",
        subtitle: "Admit attendee",
        tone: "ok",
      };
  }
}

function OverlayResultPanel({
  scanResult,
  card,
  pending,
  canAct,
  onConfirm,
  onReset,
}: {
  scanResult: CheckInScanResponse;
  card: AttendeeCardDto | null;
  pending: boolean;
  canAct: boolean;
  onConfirm?: () => void;
  onReset: () => void;
}) {
  const meta = statusMeta(scanResult.status);
  const isPreview = scanResult.status === "PREVIEW";

  return (
    <div className={`ck-overlay__result ck-overlay__result--${meta.tone}`}>
      <i className={`ti ${meta.icon} ck-overlay__result-icon`} aria-hidden="true" />
      <h2 className="ck-overlay__result-title">{meta.title}</h2>
      <p className="ck-overlay__result-sub">{meta.subtitle}</p>
      {card && (
        <div className="ck-overlay__result-card">
          <strong>{card.name}</strong>
          {card.ticket_type && <span>{card.ticket_type}</span>}
        </div>
      )}
      <div className="ck-overlay__result-actions">
        {isPreview && onConfirm && (
          <Button
            type="button"
            variant="primary"
            size="lg"
            disabled={!canAct || pending}
            onClick={onConfirm}
          >
            Confirm check-in
          </Button>
        )}
        {!isPreview && (
          <Button type="button" variant="secondary" onClick={onReset}>
            Scan next
          </Button>
        )}
        <button type="button" className="link-btn" onClick={onReset}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function CameraOverlay({
  open,
  eventTitle,
  admittedCount,
  history,
  wedgeActive,
  onClose,
  onScan,
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

  const submitManual = useCallback(() => {
    const raw = manualToken.trim();
    if (!raw) return;
    onScan(raw);
    setManualToken("");
    setManualMode(false);
  }, [manualToken, onScan]);

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
          <CameraScanner enabled wedgeActive={wedgeActive} onScan={onScan} />
          {scanResult ? (
            <OverlayResultPanel
              scanResult={scanResult}
              card={card}
              pending={pending}
              canAct={canAct}
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
          <CkRecentScans history={history} compact limit={6} />
        </aside>
      </div>

      <div className="ck-overlay__manual">
        {manualMode ? (
          <div className="ck-overlay__manual-form">
            <input
              type="text"
              className="ck-overlay__manual-input"
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              onKeyDown={onManualKeyDown}
              placeholder="Paste token or search…"
              autoComplete="off"
              spellCheck={false}
              aria-label="Enter token or search"
            />
            <Button type="button" variant="secondary" size="sm" onClick={submitManual}>
              Submit
            </Button>
            <button type="button" className="link-btn" onClick={() => setManualMode(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="link-btn" onClick={() => setManualMode(true)}>
            ⌨ Enter token or search by name
          </button>
        )}
      </div>
    </div>
  );
}
