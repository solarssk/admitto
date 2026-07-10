import { useCallback, useState } from "react";
import type { CheckInStatus } from "../api/types.js";

// Named differently from ScanFeedback.tsx (the visual status card) — this
// module is the audio/haptic layer, unrelated to that component.

const MUTE_KEY = "admitto_checkin_sound_muted";

// localStorage can throw (Safari private browsing's SecurityError, storage
// disabled by policy) — never let a mute-preference read/write break the
// scan flow. Defaults to "not muted" on failure: the feature's whole point
// is audible feedback, so failing toward silence would be the worse default.
export function isScanSoundMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setScanSoundMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, String(muted));
  } catch {
    // Best-effort only — the toggle still works for the current page life via useScanSoundMuted's own state.
  }
}

/** Shared by every surface with its own mute toggle (operator desktop shell,
 * mobile camera overlay) — keeps each in sync with localStorage without
 * needing to lift shared state through props. */
export function useScanSoundMuted(): [boolean, () => void] {
  const [muted, setMuted] = useState(isScanSoundMuted);
  const toggle = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      setScanSoundMuted(next);
      return next;
    });
  }, []);
  return [muted, toggle];
}

type FeedbackTone = "ok" | "warn" | "error";

function scanFeedbackTone(status: CheckInStatus): FeedbackTone {
  switch (status) {
    case "VALID":
    case "PREVIEW":
      return "ok";
    case "ALREADY_CHECKED_IN":
      return "warn";
    case "INVALID":
    case "REVOKED":
      return "error";
  }
}

let audioContext: AudioContext | null = null;

/** Lazily creates the shared AudioContext and resumes it — safe to call on
 * every scan. AudioContext.resume() is gated by "sticky" user activation
 * (per spec, and Firefox's own media.autoplay.block-webaudio doc): once the
 * page has seen any click/tap/keydown — which a hardware scanner's injected
 * keystrokes satisfy the same as real typing — resume() succeeds for the
 * rest of the page's life, not just inside the original gesture's call
 * stack. No vendor-prefixed fallback: unprefixed AudioContext has shipped
 * everywhere relevant (incl. iOS Safari) since 2021. */
function unlockAudio(): AudioContext | null {
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
    }
    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }
    return audioContext;
  } catch {
    return null;
  }
}

function beep(ctx: AudioContext, frequency: number, durationMs: number, delayMs = 0): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.frequency.value = frequency;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  const start = ctx.currentTime + delayMs / 1000;
  const end = start + durationMs / 1000;
  gain.gain.setValueAtTime(0.15, start);
  gain.gain.exponentialRampToValueAtTime(0.001, end);
  oscillator.start(start);
  oscillator.stop(end);
}

function playTone(tone: FeedbackTone): void {
  const ctx = unlockAudio();
  // Still "suspended" mid-resume() (e.g. the very first scan of the
  // session) — skip rather than queue; every scan after this one will have
  // a running context.
  if (!ctx || ctx.state !== "running") return;
  if (tone === "ok") beep(ctx, 880, 90);
  else if (tone === "warn") {
    beep(ctx, 520, 80);
    beep(ctx, 520, 80, 140);
  } else {
    beep(ctx, 220, 220);
  }
}

/** iOS Safari never supports the Vibration API (any browser there — all use
 * WebKit); Android Chrome and desktop Chrome do; desktop Firefox dropped it
 * in v129 (all via caniuse.com/vibration, checked 2026-07). Feature-detect
 * rather than branch on platform — `'vibrate' in navigator` is `false`
 * wherever it isn't supported, so this degrades to a silent no-op there. */
function pulseVibrate(tone: FeedbackTone): void {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  if (!("vibrate" in navigator)) return;
  try {
    if (tone === "ok") navigator.vibrate(30);
    else if (tone === "warn") navigator.vibrate([30, 60, 30]);
    else navigator.vibrate(120);
  } catch {
    // Best-effort only — never let a haptics failure affect the scan flow.
  }
}

/** Fire-and-forget scan-outcome feedback (beep + best-effort vibration).
 * Must never throw — callers run this after a scan/confirm resolves, not
 * inside error handling of their own. Vibration ignores the mute toggle
 * (silent by nature, unlike the beep) but still respects reduced-motion and
 * feature support. */
export function playScanFeedback(status: CheckInStatus): void {
  const tone = scanFeedbackTone(status);
  if (!isScanSoundMuted()) {
    try {
      playTone(tone);
    } catch {
      // Audio is a nicety — never let it break the scan flow.
    }
  }
  pulseVibrate(tone);
}
