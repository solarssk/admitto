import { SLOW_NOTICE_MS } from "../utils/loading-timing.js";
import { useDelayedLoading, useLoadingGate } from "./useDelayedLoading.js";
import type { ListLoad } from "./useListLoad.js";
import { useRetryKeepingError } from "./useRetryKeepingError.js";

/**
 * How one card that holds a list is on screen while its first load runs: the placeholder (held for the first 200ms, "Taking
 * longer than usual" after 8 seconds), the error with a Retry that stays on screen, busy, until the answer is in
 * (`failure`), or neither. A list that is enabled and has no answer yet and no error has not been asked yet, which is a wait
 * too (its request starts in the next effect). One that is not enabled, because its tab is closed, is `idle` instead: nothing
 * is under way for it, so no timer runs, and the 200ms and 8 seconds are counted from the request that opening the tab starts,
 * not from the moment the card was mounted or the tab was left. An idle card draws its placeholder (held), never an empty list.
 * `alsoWaiting` is for an answer that is not one to show, because the list is about to ask again (the page it was on is
 * gone): it is waited out like a first load, so the card never says "No ..." for it.
 */
export function useCardLoad<T>(list: ListLoad<T>, { alsoWaiting = false }: { alsoWaiting?: boolean } = {}) {
  const failure = useRetryKeepingError(list.error, list.reload);
  const unanswered = list.data === null && list.error === null;
  const idle = !list.enabled && unanswered;
  const waiting = list.enabled && (list.loading || unanswered || alsoWaiting) && !failure.running;
  const gate = useLoadingGate(waiting);
  const slow = useDelayedLoading(waiting, SLOW_NOTICE_MS);
  return { gate, slow, failure, idle };
}
