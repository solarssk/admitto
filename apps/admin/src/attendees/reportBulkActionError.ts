import type { ToastVariant } from "@admitto/ui";
import { ApiError } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";

/** The error-surfacing half of the Attendees page's bulk-action params — split out so
 * reportBulkActionError can take just these, independent of the action's result type T. */
export interface BulkActionErrorReporters {
  reportApiError: (status: number) => void;
  /** Inline dialog error setter. Omit for an action with no confirm dialog (Send tickets, Check
   * in) — those toast the error instead, matching AGENTS.md's toast-vs-inline convention. */
  setError?: (message: string | null) => void;
  addToast: (message: string, variant?: ToastVariant) => void;
  /** Passed to operatorApiErrorMessage() as the fallback for a recognized ApiError with no safe
   * user-facing detail. Ignored when mapErrorMessage is provided. */
  apiErrorFallback: string;
  /** Message shown for a thrown non-ApiError value (network failure, unexpected exception) —
   * deliberately a different string than apiErrorFallback in every caller below; that split
   * already existed per-handler before this helper, not something introduced here. */
  genericFallback: string;
  /** Overrides the default operatorApiErrorMessage(err, apiErrorFallback) computation for a
   * recognized ApiError — e.g. Change ticket type's unknown_ticket_type code needs its own copy. */
  mapErrorMessage?: (err: ApiError) => string;
}

/** Resolves and surfaces a bulk action's caught error — the 401 redirect, the
 * mapErrorMessage/operatorApiErrorMessage selection, and the setError-vs-addToast branching.
 * Extracted out of runBulkAction to keep its own cognitive complexity under SonarCloud's
 * threshold (bot review). */
export function reportBulkActionError(err: unknown, reporters: BulkActionErrorReporters): void {
  const { reportApiError, setError, addToast, apiErrorFallback, genericFallback, mapErrorMessage } = reporters;
  if (!(err instanceof ApiError)) {
    if (setError) setError(genericFallback);
    else addToast(genericFallback, "error");
    return;
  }
  reportApiError(err.status);
  if (err.status === 401) {
    const next = encodeURIComponent(window.location.pathname);
    window.location.assign(`/login?next=${next}`);
    return;
  }
  const message = mapErrorMessage ? mapErrorMessage(err) : operatorApiErrorMessage(err, apiErrorFallback);
  if (setError) setError(message);
  else addToast(message, "error");
}
