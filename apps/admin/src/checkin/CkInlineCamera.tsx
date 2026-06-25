import { useEffect } from "react";
import type { AttendeeCardDto, CheckInScanResponse } from "../api/types.js";
import { CameraScanner } from "./CameraScanner.js";
import { CheckInCameraResultPanel } from "./CheckInCameraResultPanel.js";

type CkInlineCameraProps = {
  wedgeActive: boolean;
  onScan: (raw: string) => void;
  onClose: () => void;
  scanResult: CheckInScanResponse | null;
  card: AttendeeCardDto | null;
  pending: boolean;
  canAct: boolean;
  onConfirm?: () => void;
  onReset: () => void;
};

export function CkInlineCamera({
  wedgeActive,
  onScan,
  onClose,
  scanResult,
  card,
  pending,
  canAct,
  onConfirm,
  onReset,
}: CkInlineCameraProps) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="ck-inline-camera">
      <div className="ck-inline-camera__video-wrap">
        <CameraScanner
          enabled={!scanResult && !pending}
          wedgeActive={wedgeActive}
          onScan={onScan}
        />
        {scanResult ? (
          <CheckInCameraResultPanel
            className="ck-inline-camera__result"
            scanResult={scanResult}
            card={card}
            pending={pending}
            canAct={canAct}
            onConfirm={onConfirm}
            onReset={onReset}
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
            <p className="ck-inline-camera__hint">Point the camera at the attendee&apos;s QR</p>
          </div>
        )}
      </div>
      <button
        type="button"
        className="ck-inline-camera__close"
        aria-label="Exit camera mode"
        onClick={onClose}
      >
        <i className="ti ti-x" aria-hidden="true" />
      </button>
    </div>
  );
}
