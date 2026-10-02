import { useEffect, useState } from "react";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import { loadWithTimeout } from "../utils/load-timeout.js";
import { LOAD_TIMEOUT_MESSAGE } from "../utils/loading-timing.js";
import { useRetry } from "./useRetry.js";

export interface OptionsLoad<T> {
  /** What the lookup answered (empty before the first answer, and when it failed). */
  items: T[];
  /** Nothing to offer yet: the first request of this use is on its way. */
  loading: boolean;
  /** The lookup failed, and that is not an empty list: say so, with `retry`. */
  error: string | null;
  /** Reruns this request only. */
  retry: () => void;
  /** The Retry's own flag (busy for at least 400ms), for `RetryHint`. */
  retrying: boolean;
}

/** Whether the lookup has answered (it is neither on its way nor failed), so what it holds can be shown by name. */
export function lookupReady(lookup: Pick<OptionsLoad<unknown>, "loading" | "error">): boolean {
  return !lookup.loading && lookup.error === null;
}

/**
 * A list of options that a filter or a picker offers (the events, the organizations), read once for as long as
 * `enabled` is true (a dialog that is open). A failure is not an empty list: it says so (`error`, with the 30 second
 * limit's own words for a timeout) and has a Retry (`retry`) that reruns this request only, never what the user has
 * typed. `load` must be stable (module level or `useCallback`): a new function is a new request.
 */
export function useOptionsLoad<T>(load: (signal: AbortSignal) => Promise<T[]>, fallback: string, enabled = true): OptionsLoad<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { token, retry, begin, end, busy } = useRetry();

  useEffect(() => {
    if (!enabled) {
      // A dialog that was closed reads its lookups afresh when it opens again, and shows nothing of the last time.
      setItems([]);
      setLoaded(false);
      setError(null);
      return undefined;
    }
    const controller = new AbortController();
    const limit = loadWithTimeout(controller.signal);
    // A retry keeps its error, and the busy Retry next to it, on screen until the answer is in. Any other run (the
    // first, or one for another key) has nothing of its own to show yet.
    if (!begin()) {
      setItems([]);
      setError(null);
      setLoaded(false);
    }
    load(limit.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        setItems(list);
        setLoaded(true);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(limit.timedOut() ? `${fallback} ${LOAD_TIMEOUT_MESSAGE}` : operatorApiErrorMessage(err, fallback));
      })
      .finally(() => {
        limit.done();
        if (!controller.signal.aborted) end();
      });
    return () => controller.abort();
  }, [enabled, token, load, fallback, begin, end]);

  return { items, loading: enabled && !loaded && error === null, error, retry, retrying: busy };
}
