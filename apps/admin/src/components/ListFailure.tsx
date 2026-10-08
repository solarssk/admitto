import type { RetryKeepingError } from "../hooks/useRetryKeepingError.js";
import { RefreshWarning } from "./RefreshWarning.js";
import { RetryAlert } from "./RetryAlert.js";

interface ListFailureProps {
  /**
   * The load of the list (`useCardLoad` gives it, `useRetryKeepingError(list.error, list.reload)` is what it is): when it failed
   * the error replaces the list, and its Retry stays on screen, busy, until the answer is in.
   */
  failure: RetryKeepingError;
  /** A refresh of the list on screen failed: the list stays, with this warning. */
  refreshError: string | null;
  /** Reruns the refresh: the warning's Retry. */
  onRefresh: () => Promise<void>;
  /** The card's own layout class for the error block. */
  className: string;
}

/** How a list that follows the loading standard (`useListLoad`) says that a load, or a refresh, failed. */
export function ListFailure({ failure, refreshError, onRefresh, className }: Readonly<ListFailureProps>) {
  if (failure.error) {
    return <RetryAlert message={failure.error} retrying={failure.retrying} onRetry={failure.retry} className={className} />;
  }
  return refreshError ? <RefreshWarning message={refreshError} onRetry={onRefresh} /> : null;
}
