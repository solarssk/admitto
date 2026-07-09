import { useCallback, useEffect, useRef } from "react";
import type { CheckInScanResponse } from "../api/types.js";
import { CameraScanner } from "./CameraScanner.js";
import { ScanFeedback } from "./ScanFeedback.js";

type CkInlineCameraProps = {
  wedgeActive: boolean;
  /** Pause ZXing while a result is shown in AttendeeCard or overlay. */
  scannerPaused: boolean;
  /** Compact pass/fail overlay on video; null when AttendeeCard renders below. */
  overlayScanResult: CheckInScanResponse | null;
  onScan: (raw: string) => void;
  onClose: () => void;
  onReset: () => void;
};

export function CkInlineCamera({
  wedgeActive,
  scannerPaused,
  overlayScanResult,
  onScan,
  onClose,
  onReset,
}: CkInlineCameraProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  const dismiss = useCallback(() => {
    onReset();
    onClose();
  }, [onClose, onReset]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  return (
    <div className="ck-inline-camera">
      <div className="ck-inline-camera__video-wrap">
        <CameraScanner
          enabled={!scannerPaused}
          wedgeActive={wedgeActive}
          onScan={onScan}
        />
        {overlayScanResult ? (
          // Desktop camera reuses the same lightweight ScanFeedback card the
          // typed-search path renders (never a check-in card here: a real
          // attendee match promotes to AttendeeCard below, so this only ever
          // shows an invalid/no-match status) — one styled component for both
          // surfaces instead of the mobile overlay's full-color result panel,
          // which read as an unpolished leftover on desktop (PO review).
          <ScanFeedback result={overlayScanResult} />
        ) : (
          <div className="ck-inline-camera__viewfinder" aria-hidden="true">
            <div className="vf-frame">
              <span className="c tl" />
              <span className="c tr" />
              <span className="c bl" />
              <span className="c br" />
              <span className="vf-line" />
            </div>
          </div>
        )}
      </div>
      {!overlayScanResult && !scannerPaused && (
        <p className="ck-inline-camera__hint">Point the camera at the attendee&apos;s QR</p>
      )}
      <button
        ref={closeRef}
        type="button"
        className="ck-inline-camera__close"
        aria-label="Exit camera mode"
        onClick={dismiss}
      >
        <i className="ti ti-x" aria-hidden="true" />
      </button>
    </div>
  );
}
