import { useCallback, useRef, useState } from "react";
import { useMinimumBusy } from "./useDelayedLoading.js";

/**
 * How often `busy` has gone from true to false. A live region says nothing when its text is replaced by the same
 * text, so a message that a retry failed to clear is mounted afresh (`key={ends}`) when the retry ends with it still
 * there. Counted while rendering, so the new message is in the same commit that ends the busy state, not one
 * frame after it (the same reasoning as `Notice`'s `actionBusy`).
 */
export function useBusyEndCount(busy: boolean): number {
  const [wasBusy, setWasBusy] = useState(busy);
  const [ends, setEnds] = useState(0);
  if (wasBusy !== busy) {
    setWasBusy(busy);
    if (wasBusy) setEnds((n) => n + 1);
  }
  return ends;
}

/**
 * The state behind a Retry that re-runs one request, such as a catalog of ticket types that failed to load.
 *
 * - `token` goes into the request effect's dependencies, and `retry()` bumps it, so the click re-runs the effect.
 * - The effect calls `begin()` first. It says whether this run is a Retry's. A Retry keeps the error, and the
 *   busy Retry button next to it, on screen until the answer is in: a hint that disappears on the click takes
 *   the keyboard focus with it. Any other run (the first load, another event) starts with no error. A run
 *   that was not aborted calls `end()` once it has answered.
 * - `busy` is what the Retry button passes as `loading`: from the click until the answer, and for at least
 *   400ms (`useMinimumBusy`), so a retry that fails again at once still shows that it ran. It is only true
 *   for a Retry's own run, never for the first load that produced the error.
 */
export function useRetry() {
  const [token, setToken] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const byRetry = useRef(false);

  const retry = useCallback(() => {
    byRetry.current = true;
    setRetrying(true);
    setToken((n) => n + 1);
  }, []);

  const begin = useCallback(() => {
    const isRetry = byRetry.current;
    byRetry.current = false;
    // A run that is not a retry's (another event, say) replaces a retry that was still going.
    if (!isRetry) setRetrying(false);
    return isRetry;
  }, []);

  const end = useCallback(() => setRetrying(false), []);

  const busy = useMinimumBusy(retrying);
  return { token, retry, begin, end, busy };
}
