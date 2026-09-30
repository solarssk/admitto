import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Delays showing a loading state by `delayMs` so a request that resolves
 * near-instantly (localhost, a warm cache) never shows a spinner at all —
 * it would otherwise flash on and off faster than a user can consciously
 * register it, reading as a glitch rather than an actual loading state.
 * Returns true only once `isLoading` has stayed true continuously for at
 * least `delayMs`; a request that finishes before that never flips it on.
 */
export function useDelayedLoading(isLoading: boolean, delayMs = 200): boolean {
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowLoading(false);
      return;
    }
    const timer = setTimeout(() => setShowLoading(true), delayMs);
    return () => clearTimeout(timer);
  }, [isLoading, delayMs]);

  return showLoading;
}

/** The single "only render this spinner/skeleton once the delay has elapsed" building
 * block behind `useDelayedLoading` - `show` is the hook's own return value, never the raw
 * `isLoading` flag it was computed from (which still has to gate a component's own
 * loading/empty/data branch on its own, this only ever decides the spinner within it). */
export function whenShown(show: boolean, content: ReactNode): ReactNode {
  return show ? content : null;
}

export interface LoadingGateOptions {
  /** Wait before the indicator first appears. Default 200ms. */
  delayMs?: number;
  /** Once shown, keep the indicator at least this long so it never flickers. Default 400ms. */
  minVisibleMs?: number;
}

export interface LoadingGate {
  /** Render the loading indicator (logo, skeleton, bar). */
  showIndicator: boolean;
  /** Render the real content. False while loading and while the indicator is finishing its minimum time. */
  showContent: boolean;
}

/**
 * The full loading lifecycle every screen follows:
 * - a response faster than `delayMs` never shows an indicator and goes straight to the content;
 * - an indicator that did appear stays for at least `minVisibleMs` before the content replaces it.
 *
 * `useDelayedLoading` only covers the first rule, so a load that finishes just after the delay
 * still flashes the indicator for a few frames. Gate the content branch on `showContent`, not on
 * the raw `isLoading`, or the second rule has no effect.
 */
export function useLoadingGate(
  isLoading: boolean,
  { delayMs = 200, minVisibleMs = 400 }: LoadingGateOptions = {},
): LoadingGate {
  const [showIndicator, setShowIndicator] = useState(false);
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    if (isLoading) {
      // An overlapping reload while the indicator is already up keeps it up.
      if (shownAt.current !== null) return undefined;
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setShowIndicator(true);
      }, delayMs);
      return () => clearTimeout(timer);
    }
    const shownSince = shownAt.current;
    if (shownSince === null) {
      setShowIndicator(false);
      return undefined;
    }
    const timer = setTimeout(
      () => {
        shownAt.current = null;
        setShowIndicator(false);
      },
      Math.max(0, minVisibleMs - (Date.now() - shownSince)),
    );
    return () => clearTimeout(timer);
  }, [isLoading, delayMs, minVisibleMs]);

  return { showIndicator, showContent: !isLoading && !showIndicator };
}
