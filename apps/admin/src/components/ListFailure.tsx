import { Button } from "@admitto/ui";
import { RefreshWarning } from "./RefreshWarning.js";

interface ListFailureProps {
  /** The list could not be loaded: it replaces the list, and its Retry starts a first load again. */
  error: string | null;
  /** A refresh of the list on screen failed: the list stays, with this warning. */
  refreshError: string | null;
  onRetry: () => Promise<void>;
  /** The card's own layout class for the error block. */
  className: string;
}

/** How a list that follows the loading standard (`useListLoad`) says that a load, or a refresh, failed. */
export function ListFailure({ error, refreshError, onRetry, className }: Readonly<ListFailureProps>) {
  if (error) {
    return (
      <div className={className} role="alert">
        <p>{error}</p>
        <Button type="button" variant="secondary" onClick={() => void onRetry()}>
          Retry
        </Button>
      </div>
    );
  }
  return refreshError ? <RefreshWarning message={refreshError} onRetry={onRetry} /> : null;
}
