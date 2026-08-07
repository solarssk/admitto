import type { ToastVariant } from "@admitto/ui";
import { fetchBulkSendStatus } from "../api/client.js";

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type PollBulkSendCompletionOptions = {
  maxAttempts?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Cancel polling when the operator leaves Attendees or switches events. */
  signal?: AbortSignal;
};

/** Poll batch status until the worker drains the queue, then toast the terminal counts. */
export async function pollBulkSendCompletion(
  eventId: string,
  batchId: string,
  addToast: (message: string, variant?: ToastVariant) => void,
  options: PollBulkSendCompletionOptions = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 90;
  const intervalMs = options.intervalMs ?? 2000;
  const signal = options.signal;
  const sleep =
    options.sleep ?? ((ms: number) => sleepWithAbort(ms, signal));

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (signal?.aborted) return;
      const status = await fetchBulkSendStatus(eventId, batchId, signal);
      if (status.queued === 0) {
        if (status.failed === 0) {
          addToast(
            `Send complete: ${status.sent} ${pluralize(status.sent, "ticket")} sent.`,
            "success",
          );
        } else if (status.sent === 0) {
          addToast(`Send failed: ${status.failed} ${pluralize(status.failed, "ticket")}.`, "error");
        } else {
          addToast(`Send complete: ${status.sent} sent, ${status.failed} failed.`, "warning");
        }
        return;
      }
      await sleep(intervalMs);
    }
    if (signal?.aborted) return;
    addToast("Send is still running in the background. Check Communication for status.", "info");
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) return;
    throw err;
  }
}
