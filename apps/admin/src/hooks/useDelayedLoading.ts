import { useEffect, useState, type ReactNode } from "react";

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
