import { useEffect, useRef, useState } from "react";

type CameraScannerProps = {
  enabled: boolean;
  wedgeActive: boolean;
  onScan: (raw: string) => void;
};

export function CameraScanner({ enabled, wedgeActive, onScan }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

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
          if (result && !stopped) onScanRef.current(result.getText());
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

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => setIsFullscreen(true));
    } else {
      void document.exitFullscreen();
    }
  };

  if (!enabled) return null;

  return (
    <div
      ref={containerRef}
      className={`checkin-camera${isFullscreen ? " checkin-camera--fullscreen" : ""}`}
    >
      <video ref={videoRef} className="checkin-camera__video" muted playsInline />
      <button
        type="button"
        className="checkin-camera__fullscreen-btn"
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      >
        <i className={isFullscreen ? "ti ti-minimize" : "ti ti-maximize"} aria-hidden="true" />
      </button>
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
