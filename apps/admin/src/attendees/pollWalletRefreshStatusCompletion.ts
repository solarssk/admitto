import type { ToastVariant } from "@admitto/ui";
import { fetchWalletRefreshStatusJobStatus, type WalletRefreshStatusJobStatusResponse } from "../api/client.js";
import { isAbortError, sleepWithAbort } from "./sleepWithAbort.js";

export type PollWalletRefreshStatusCompletionOptions = {
  maxAttempts?: number;
  intervalMs?: number;
  /** Cancel polling when the operator leaves Attendees or switches events. */
  signal: AbortSignal;
  /** Called once the job reaches "succeeded", after the toast - the caller reloads the attendee
   * list so the Wallet column's registration counts reflect what the job just wrote (P2 review:
   * the list otherwise keeps showing pre-refresh statuses until a manual reload). Not called for
   * "failed", still-running, or an aborted poll - there's nothing new to show in those cases. */
  onSuccess?: () => void;
};

/** The success-toast branch of pollWalletRefreshStatusCompletion, split out to keep that
 * function's own cognitive complexity down, same reasoning as pollWalletPushCompletion's own
 * toastWalletPushSucceeded. */
function toastWalletRefreshStatusSucceeded(
  status: WalletRefreshStatusJobStatusResponse,
  addToast: (message: string, variant?: ToastVariant) => void,
): void {
  const refreshed = status.refreshed ?? 0;
  const skipped = status.skipped ?? 0;
  const errored = status.errored ?? 0;

  if (errored > 0) {
    addToast(`Wallet status refresh: ${refreshed} updated, ${errored} failed.`, "warning");
    return;
  }
  if (refreshed === 0) {
    addToast("Wallet status refresh finished - nothing needed refreshing.", "info");
    return;
  }
  const skippedNote = skipped > 0 ? ` (${skipped} skipped)` : "";
  addToast(`${refreshed} wallet ${refreshed === 1 ? "pass" : "passes"} refreshed${skippedNote}.`, "success");
}

/** Poll a wallet_refresh_status job until it reaches a terminal state, then toast the outcome.
 * Same shape as pollWalletPushCompletion (sibling file) - a large refresh is rate-limited by
 * PassCreator itself (ADR 0041 §3, 600 req/min), not something a longer wait here would speed up,
 * so a job still running after maxAttempts is reported as background work, not a failure. */
export async function pollWalletRefreshStatusCompletion(
  eventId: string,
  jobId: string,
  addToast: (message: string, variant?: ToastVariant) => void,
  options: PollWalletRefreshStatusCompletionOptions,
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 900;
  const intervalMs = options.intervalMs ?? 2000;
  const signal = options.signal;
  const onSuccess = options.onSuccess;

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (signal.aborted) return;
      const status = await fetchWalletRefreshStatusJobStatus(eventId, jobId, signal);
      if (status.status === "succeeded") {
        toastWalletRefreshStatusSucceeded(status, addToast);
        onSuccess?.();
        return;
      }
      if (status.status === "failed") {
        addToast("Wallet status refresh failed to run. Try Refresh status from the wallet menu.", "error");
        return;
      }
      await sleepWithAbort(intervalMs, signal);
    }
    if (signal.aborted) return;
    addToast("Wallet status refresh is still running in the background.", "info");
  } catch (err) {
    if (isAbortError(err) || signal.aborted) return;
    throw err;
  }
}
