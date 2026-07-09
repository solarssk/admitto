import { useEffect, useRef, useState } from "react";

type CameraScannerProps = {
  enabled: boolean;
  wedgeActive: boolean;
  onScan: (raw: string) => void;
};

/** Ignore repeated ZXing decodes of the same QR while it stays in frame. */
const CAMERA_SCAN_COOLDOWN_MS = 2500;

export function CameraScanner({ enabled, wedgeActive, onScan }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onScanRef = useRef(onScan);
  const lastEmitRef = useRef<{ text: string; at: number } | null>(null);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled || wedgeActive) return;

    let stopped = false;
    let controls: { stop: () => void } | null = null;

    async function start() {
      setError(null);
      const video = videoRef.current;
      if (!video) return;

      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (stopped) return;

        const reader = new BrowserQRCodeReader();
        const nextControls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
          if (!result || stopped) return;

          const text = result.getText();
          const now = Date.now();
          const last = lastEmitRef.current;
          if (last && last.text === text && now - last.at < CAMERA_SCAN_COOLDOWN_MS) return;

          lastEmitRef.current = { text, at: now };
          onScanRef.current(text);
        });
        if (stopped) {
          nextControls.stop();
          return;
        }
        controls = nextControls;
      } catch {
        if (!stopped) setError("Camera unavailable or permission denied.");
      }
    }

    void start();
    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [enabled, wedgeActive]);

  // The <video> stays mounted (hidden via the `hidden` attribute) even
  // when disabled, instead of being unmounted — removing it from the
  // document while ZXing's internal video.play() is still settling throws
  // an unhandled AbortError ("play() request was interrupted because the
  // media was removed from the document"). `enabled` toggles on every scan
  // result and every entry into the item-issuing screen, so unmounting
  // fired this often. The effect above already fully starts/stops the
  // reader based on `enabled`; only the DOM presence/visibility changes
  // here.
  return (
    <div className="checkin-camera" hidden={!enabled}>
      <video
        ref={videoRef}
        className="checkin-camera__video"
        muted
        playsInline
        autoPlay
        aria-label="Live camera preview for QR scanning"
      />
      {wedgeActive && (
        <p className="at-hint">Camera paused — scan field has input (wedge priority).</p>
      )}
      {error && (
        <p className="checkin-surface__transport-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
