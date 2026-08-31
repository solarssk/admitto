import type { ToastVariant } from "@admitto/ui";
import { fetchWalletPushJobStatus, type WalletPushJobStatusResponse } from "../api/client.js";
import { isAbortError, sleepWithAbort } from "./sleepWithAbort.js";

export type PollWalletPushCompletionOptions = {
  maxAttempts?: number;
  intervalMs?: number;
  /** Cancel polling when the operator leaves Attendees or switches events. */
  signal: AbortSignal;
};

/** The success-toast branch of pollWalletPushCompletion, split out to keep that function's own
 * cognitive complexity under SonarCloud's threshold (bot review) and to build the "N skipped"
 * note as a plain variable instead of a template literal nested inside another one. */
function toastWalletPushSucceeded(
  status: WalletPushJobStatusResponse,
  addToast: (message: string, variant?: ToastVariant) => void,
): void {
  const reissued = status.reissued ?? 0;
  const skipped = status.skipped ?? 0;
  const errored = status.errored ?? 0;

  if (errored > 0) {
    addToast(`Wallet pass update: ${reissued} updated, ${errored} failed.`, "warning");
    return;
  }
  if (reissued === 0) {
    addToast("Wallet pass update finished - nothing needed pushing.", "info");
    return;
  }
  const skippedNote = skipped > 0 ? ` (${skipped} skipped)` : "";
  addToast(`${reissued} wallet ${reissued === 1 ? "pass" : "passes"} updated${skippedNote}.`, "success");
}

/** Poll a wallet_push job until it reaches a terminal state, then toast the outcome. Same
 * shape as pollBulkSendCompletion (sibling file) - a large push is rate-limited by PassCreator
 * itself (ADR 0041 §3, 600 req/min), not something a longer wait here would speed up, so a job
 * still running after maxAttempts is reported as background work, not a failure. */
export async function pollWalletPushCompletion(
  eventId: string,
  jobId: string,
  addToast: (message: string, variant?: ToastVariant) => void,
  options: PollWalletPushCompletionOptions,
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 900;
  const intervalMs = options.intervalMs ?? 2000;
  const signal = options.signal;

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (signal.aborted) return;
      const status = await fetchWalletPushJobStatus(eventId, jobId, signal);
      if (status.status === "succeeded") {
        toastWalletPushSucceeded(status, addToast);
        return;
      }
      if (status.status === "failed") {
        addToast("Wallet pass update failed to run. Try Push updates from the wallet menu.", "error");
        return;
      }
      await sleepWithAbort(intervalMs, signal);
    }
    if (signal.aborted) return;
    addToast("Wallet pass update is still running in the background.", "info");
  } catch (err) {
    if (isAbortError(err) || signal.aborted) return;
    throw err;
  }
}
