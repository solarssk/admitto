import { useCallback, useRef, useState } from "react";

/** The Image Capture API's `torch` capability/constraint isn't in TS's DOM lib yet - same gap as
 * the `focusMode` cast in CameraScanner.tsx - so both are widened locally instead of touching the
 * global lib types. */
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };
type TorchConstraintSet = MediaTrackConstraintSet & { torch?: boolean };

export type CameraTorchControl = {
  /** Only ever true once the active track has actually reported the capability - never true
   * while unknown, so callers can use it directly to decide whether to render a torch button at
   * all instead of showing one that's disabled on every device that doesn't support it (which is
   * most laptops and all of iOS). */
  torchSupported: boolean;
  torchOn: boolean;
  toggleTorch: () => void;
  /** Wire to CameraScanner's onTrackChange - called with the active video track once decoding
   * starts, and null once it stops. */
  onTrackChange: (track: MediaStreamTrack | null) => void;
};

/** Owns the torch toggle's state and its link to whichever camera surface is currently mounted
 * (desktop inline panel or mobile overlay - never both at once, so a single MediaStreamTrack
 * reference is enough). Torch needs a live track to call applyConstraints on, unlike the
 * scan-sound mute preference (scanSoundFeedback.ts), so it can't be a simple persisted boolean. */
export function useCameraTorch(): CameraTorchControl {
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const onTrackChange = useCallback((track: MediaStreamTrack | null) => {
    trackRef.current = track;
    // A fresh getUserMedia call always starts with torch off regardless of
    // its previous state, so the UI shouldn't claim otherwise across a
    // camera restart (toggle off/on, or a scan result swapping the track).
    setTorchOn(false);
    if (!track) {
      setTorchSupported(false);
      return;
    }
    const capabilities = track.getCapabilities?.() as TorchCapabilities | undefined;
    setTorchSupported(!!capabilities?.torch);
  }, []);

  const toggleTorch = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    track
      .applyConstraints({ advanced: [{ torch: next } as TorchConstraintSet] })
      .then(() => setTorchOn(next))
      .catch(() => {
        // getCapabilities() said this should work; a mid-session driver
        // failure just leaves the toggle at its last known-applied state
        // instead of showing "on" for a constraint that didn't actually apply.
      });
  }, [torchOn]);

  return { torchSupported, torchOn, toggleTorch, onTrackChange };
}
