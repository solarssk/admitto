import { useEffect, useRef, useState } from "react";

type CameraScannerProps = {
  enabled: boolean;
  /** When true, camera decode is paused (wedge / keyboard input takes priority). */
  wedgeActive: boolean;
  onScan: (raw: string) => void;
};

/**
 * Opt-in camera QR decode via dynamic @zxing/browser import.
 * getUserMedia runs only when `enabled` is true.
 */
export function CameraScanner({ enabled, wedgeActive, onScan }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onScanRef = useRef(onScan);
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
        controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
          if (result && !stopped) {
            onScanRef.current(result.getText());
          }
        });
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

  if (!enabled) return null;

  return (
    <div className="checkin-camera">
      <video ref={videoRef} className="checkin-camera__video" muted playsInline />
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
