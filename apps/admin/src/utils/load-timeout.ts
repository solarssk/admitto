import { LOAD_TIMEOUT_MS } from "./loading-timing.js";

export interface LoadTimeout {
  /** Pass this to the request: it aborts when `parent` does (the page going away) and after `ms`. */
  signal: AbortSignal;
  /** True when it was the wait that ran out, not `parent` that was aborted. */
  timedOut: () => boolean;
  /** Clear the timer and the link to `parent`, whatever the outcome of the request. */
  done: () => void;
}

/**
 * The 30 second limit of AGENTS.md "Admin SPA loading and busy states" for a load that shows a placeholder
 * while it runs: after `ms` the request is abandoned, so the caller can end in an error with Retry instead
 * of a loader that never stops. A caller that is itself aborted (its page left) stays silent: check
 * `parent?.aborted` before `timedOut()`.
 */
export function loadWithTimeout(parent?: AbortSignal, ms: number = LOAD_TIMEOUT_MS): LoadTimeout {
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

/**
 * `promise`, or a rejection (an `AbortError`) as soon as `signal` aborts: a request that was not given the signal, or
 * ignores it, still stops being waited for when its time is up.
 */
export function rejectOnAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const abortError = () => new DOMException("The operation was aborted.", "AbortError");
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

