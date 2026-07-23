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
}: Readonly<CkInlineCameraProps>) {
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
          // CheckInPage never sets scanResult (so this never receives one)
          // for an INVALID/no-match scan while the camera is active — that
          // reports via the same toast manual lookup's no-match uses instead,
          // since the camera is scan-only here and shouldn't pause on a miss
          // (PO review). This branch is only reachable for the brief window
          // between a PREVIEW response landing and its attendee card finishing
          // its fetch, right before AttendeeCard takes over below.
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
