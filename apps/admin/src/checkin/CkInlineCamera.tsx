import { useCallback, useEffect, useRef } from "react";
import type { AttendeeCardDto, CheckInScanResponse } from "../api/types.js";
import { CameraScanner } from "./CameraScanner.js";
import { CheckInCameraResultPanel } from "./CheckInCameraResultPanel.js";

type CkInlineCameraProps = {
  wedgeActive: boolean;
  /** Pause ZXing while a result is shown in AttendeeCard or overlay. */
  scannerPaused: boolean;
  /** Compact pass/fail overlay on video; null when AttendeeCard renders below. */
  overlayScanResult: CheckInScanResponse | null;
  onScan: (raw: string) => void;
  onClose: () => void;
  card: AttendeeCardDto | null;
  pending: boolean;
  canAct: boolean;
  eventTimezone: string;
  onConfirm?: () => void;
  onReset: () => void;
};

export function CkInlineCamera({
  wedgeActive,
  scannerPaused,
  overlayScanResult,
  onScan,
  onClose,
  card,
  pending,
  canAct,
  eventTimezone,
  onConfirm,
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
          <CheckInCameraResultPanel
            className="ck-inline-camera__result"
            scanResult={overlayScanResult}
            card={card}
            pending={pending}
            canAct={canAct}
            eventTimezone={eventTimezone}
            onConfirm={onConfirm}
            onReset={onReset}
            onCancel={dismiss}
          />
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
