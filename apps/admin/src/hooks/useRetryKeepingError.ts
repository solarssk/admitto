import { useCallback, useEffect, useRef, useState } from "react";
import { useMinimumBusy } from "./useDelayedLoading.js";

export interface RetryKeepingError {
  /** The error to show: the failure that is there, and, while a Retry of it runs, the one that was on screen. */
  error: string | null;
  /** The Retry button's `loading`: busy from the click until the answer is in, and for at least 400ms. */
  retrying: boolean;
  /** The Retry is running right now (no 400ms minimum): a placeholder must not take the error's place meanwhile. */
  running: boolean;
  /** Runs the request again after a failure. It does nothing when there is no failure to retry. */
  retry: () => Promise<void>;
}

/**
 * The Retry of a load that failed, on the loading standard (AGENTS.md "Admin SPA loading and busy states"): the click
 * runs the request again, and the error and its Retry stay on screen, busy, until the answer is in, instead of a
 * placeholder taking their place (a Retry that disappears on the click takes the keyboard focus with it, and the
 * screen would say "No entries yet" for a load that has not answered). `run` is the request that failed; `error` is
 * the message of the failure, null when there is none.
 */
export function useRetryKeepingError(error: string | null, run: () => Promise<unknown>): RetryKeepingError {
  const [running, setRunning] = useState(false);
  const retrying = useMinimumBusy(running);
  const lastError = useRef<string | null>(null);
  useEffect(() => {
    if (error) lastError.current = error;
  });
  const retry = useCallback(async () => {
    if (!error) return;
    setRunning(true);
    try {
      await run();
    } finally {
      setRunning(false);
    }
  }, [error, run]);
  return { error: error ?? (running ? lastError.current : null), retrying, running, retry };
}
