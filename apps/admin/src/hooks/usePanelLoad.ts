import { useCallback, useEffect, useRef } from "react";
import { SLOW_NOTICE_MS } from "../utils/loading-timing.js";
import { useDelayedLoading, useLoadingGate, type LoadingGate } from "./useDelayedLoading.js";
import { useListLoad } from "./useListLoad.js";
import { useRetryKeepingError } from "./useRetryKeepingError.js";

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
 * What a panel (or a modal that reads a record when it opens) shows now: the placeholder, the error, or the form. A load
 * that fails before the placeholder was drawn (within 200ms) shows the error at once; one that fails after it was drawn
 * keeps the placeholder for its 400ms minimum first, like the form does, so it never flashes for a moment and goes.
 */
export function panelView(panel: Pick<PanelLoad, "gate" | "error">): "loading" | "error" | "ready" {
  if (!panel.gate.showContent) return "loading";
  return panel.error === null ? "ready" : "error";
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

  const { error, retrying, running, retry } = useRetryKeepingError(list.error, list.reload);

  // A Retry is not a first load to cover with a placeholder: the error that was on screen stays, with its busy button.
  const gate = useLoadingGate(list.loading && !running);
  const slow = useDelayedLoading(list.loading && !running, SLOW_NOTICE_MS);
  return { gate, slow, error, retrying, retry };
}
