import type { ToastVariant } from "@admitto/ui";
import { fetchWalletCleanupJobStatus, type WalletCleanupJobStatusResponse } from "../api/client.js";
import { isAbortError, sleepWithAbort } from "./sleepWithAbort.js";
import { WALLET_CLEANUP_COPY, type WalletCleanupAction } from "./walletCleanupCopy.js";

export type PollWalletCleanupCompletionOptions = {
  maxAttempts?: number;
  intervalMs?: number;
  /** Cancel polling when the operator leaves Attendees or switches events. */
  signal: AbortSignal;
  /** Called once the job reaches "succeeded", after the toast, so the caller can reload the
   * attendee list and show the new pass statuses. Not called for "failed", a still-running or an
   * aborted poll - there is nothing new to show in those cases. */
  onSuccess?: () => void;
};

function toastWalletCleanupSucceeded(
  copy: (typeof WALLET_CLEANUP_COPY)[WalletCleanupAction],
  status: WalletCleanupJobStatusResponse,
  addToast: (message: string, variant?: ToastVariant) => void,
): void {
  const done = status.done ?? 0;
  const skipped = status.skipped ?? 0;
  const errored = status.errored ?? 0;

  if (errored > 0) addToast(copy.withErrors(done, errored), "warning");
  else if (done === 0) addToast(copy.nothing(status.pendingGraceCount ?? 0), "info");
  else addToast(copy.done(done, skipped), "success");
}

/** Poll an event-wide wallet clean-up job until it reaches a terminal state, then toast the
 * outcome. Same shape as pollWalletRefreshStatusCompletion: a large event is rate-limited by the
 * provider itself, so a job still running after maxAttempts is reported as background work, not a
 * failure. */
export async function pollWalletCleanupCompletion(
  action: WalletCleanupAction,
  eventId: string,
  jobId: string,
  addToast: (message: string, variant?: ToastVariant) => void,
  options: PollWalletCleanupCompletionOptions,
): Promise<void> {
  const copy = WALLET_CLEANUP_COPY[action];
  const maxAttempts = options.maxAttempts ?? 900;
  const intervalMs = options.intervalMs ?? 2000;
  const signal = options.signal;

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (signal.aborted) return;
      const status = await fetchWalletCleanupJobStatus(eventId, jobId, signal);
      if (status.status === "succeeded") {
        toastWalletCleanupSucceeded(copy, status, addToast);
        options.onSuccess?.();
        return;
      }
      if (status.status === "failed") {
        addToast(copy.failed, "error");
        return;
      }
      await sleepWithAbort(intervalMs, signal);
    }
    if (signal.aborted) return;
    addToast(copy.stillRunning, "info");
  } catch (err) {
    if (isAbortError(err) || signal.aborted) return;
    throw err;
  }
}
