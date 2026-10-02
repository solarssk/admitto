import { useCallback, useEffect, useRef, useState } from "react";
import { SLOW_NOTICE_MS } from "../utils/loading-timing.js";
import { useDelayedLoading, useLoadingGate, useMinimumBusy, type LoadingGate } from "./useDelayedLoading.js";
import { useListLoad } from "./useListLoad.js";

export interface PanelLoad {
  /** The placeholder's timing: it is drawn after 200ms (`showIndicator`), and the content waits for `showContent`. */
  gate: LoadingGate;
  /** The first load has taken more than 8 seconds: the placeholder says so. */
  slow: boolean;
  /** The first load failed (or ran out of its 30 seconds): the panel is an error with a Retry, not an empty form. */
  error: string | null;
  /** The Retry's own flag (busy for at least 400ms): the error and its button stay on screen until the answer is in. */
  retrying: boolean;
  /** Loads the panel again after a failed first load. It does nothing while the panel is loaded, whose form is not touched. */
  retry: () => Promise<void>;
}

/**
 * The first load of a settings panel (what its form is filled from) on the loading standard: nothing is drawn for the
 * first 200ms and a placeholder after that (`gate`), "Taking longer than usual" after 8 seconds (`slow`), and after 30
 * seconds an error with Retry (`error`, `retry`), instead of a bare "Loading…" or a panel that never answers. A Retry
 * keeps the error and its busy button on screen until the answer is in, so the keyboard keeps its place.
 *
 * `fetch` reads the data (pass `signal` to every request) and returns it; `apply` puts it into the panel's own state, and
 * is called only with the newest answer, so a superseded one never overwrites a newer one. Neither needs to be stable.
 * A failure is thrown out of `fetch`: this hook turns it into `error`.
 */
export function usePanelLoad<T>({
  fetch,
  apply,
  fallback,
}: {
  fetch: (signal: AbortSignal) => Promise<T>;
  apply: (data: T) => void;
  fallback: string;
}): PanelLoad {
  const fetchRef = useRef(fetch);
  const applyRef = useRef(apply);
  useEffect(() => {
    fetchRef.current = fetch;
    applyRef.current = apply;
  });
  const fetcher = useCallback((signal: AbortSignal) => fetchRef.current(signal), []);
  const onData = useCallback((data: T) => applyRef.current(data), []);
  const list = useListLoad({ fetcher, fallback, onData });

  const [retrying, setRetrying] = useState(false);
  const busy = useMinimumBusy(retrying);
  const lastError = useRef<string | null>(null);
  useEffect(() => {
    if (list.error) lastError.current = list.error;
  });
  const { reload, error: failure } = list;
  const retry = useCallback(async () => {
    if (!failure) return;
    setRetrying(true);
    try {
      await reload();
    } finally {
      setRetrying(false);
    }
  }, [reload, failure]);

  // A Retry is not a first load to cover with a placeholder: the error that was on screen stays, with its busy button.
  const gate = useLoadingGate(list.loading && !retrying);
  const slow = useDelayedLoading(list.loading && !retrying, SLOW_NOTICE_MS);
  const error = list.error ?? (retrying ? lastError.current : null);
  return { gate, slow, error, retrying: busy, retry };
}
