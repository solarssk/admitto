import { ApiError } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { ToastVariant } from "@admitto/ui";

/** Shared catch-block logic for an export button's failed fetch: an abort is a silent no-op (a
 * newer export superseded it, or the user navigated away), a 401 redirects to login, any other
 * `ApiError` gets operator-safe text, and everything else falls back to the generic message.
 * Used by AttendeesPage's per-event export and ReportsPage's CSV export, which fail against the
 * same kind of endpoint the same way. */
export function handleExportRequestError(
  err: unknown,
  fallback: string,
  addToast: (message: string, variant?: ToastVariant, duration?: number) => void,
  reportApiError: (status: number) => void,
): void {
  if (err instanceof DOMException && err.name === "AbortError") return;
  if (err instanceof ApiError) {
    reportApiError(err.status);
    if (err.status === 401) {
      const next = encodeURIComponent(window.location.pathname);
      window.location.assign(`/login?next=${next}`);
      return;
    }
    addToast(operatorApiErrorMessage(err, fallback), "error");
  } else {
    addToast(fallback, "error");
  }
}
