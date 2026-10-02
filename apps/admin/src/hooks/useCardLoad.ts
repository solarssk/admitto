import { SLOW_NOTICE_MS } from "../utils/loading-timing.js";
import { useDelayedLoading, useLoadingGate } from "./useDelayedLoading.js";
import type { ListLoad } from "./useListLoad.js";
import { useRetryKeepingError } from "./useRetryKeepingError.js";

/**
 * How one card that holds a list is on screen while its first load runs: the placeholder (held for the first 200ms, "Taking
 * longer than usual" after 8 seconds), the error with a Retry that stays on screen, busy, until the answer is in
 * (`failure`), or neither. A list that has no answer yet and no error has not been asked yet, which is a wait too (a list
 * that starts only once its tab is open).
 */
export function useCardLoad<T>(list: ListLoad<T>) {
  const failure = useRetryKeepingError(list.error, list.reload);
  const waiting = (list.loading || (list.data === null && list.error === null)) && !failure.running;
  const gate = useLoadingGate(waiting);
  const slow = useDelayedLoading(waiting, SLOW_NOTICE_MS);
  return { gate, slow, failure };
}
