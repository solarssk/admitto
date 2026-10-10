import type { RetryKeepingError } from "../hooks/useRetryKeepingError.js";
import { RefreshWarning } from "./RefreshWarning.js";
import { RetryEmptyState } from "./RetryEmptyState.js";

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
  /** What failed, as the title of the error ("Could not load users"). */
  title: string;
}

/** How a list that follows the loading standard (`useListLoad`) says that a load, or a refresh, failed. */
export function ListFailure({ failure, refreshError, onRefresh, title }: Readonly<ListFailureProps>) {
  if (failure.error) {
    // The same placeholder as every other failed load (the glyph over a title, the message and a Retry), which fades in with what it
    // replaces and stays mounted through a Retry, so that it plays once.
    return <RetryEmptyState title={title} message={failure.error} retrying={failure.retrying} onRetry={failure.retry} className="at-fade-in" />;
  }
  return refreshError ? <RefreshWarning message={refreshError} onRetry={onRefresh} /> : null;
}
