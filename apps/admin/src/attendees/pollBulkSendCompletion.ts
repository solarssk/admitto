import type { ToastVariant } from "@admitto/ui";
import { fetchBulkSendStatus } from "../api/client.js";

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

export type PollBulkSendCompletionOptions = {
  maxAttempts?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Poll batch status until the worker drains the queue, then toast the terminal counts. */
export async function pollBulkSendCompletion(
  eventId: string,
  batchId: string,
  addToast: (message: string, variant?: ToastVariant) => void,
  options: PollBulkSendCompletionOptions = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 90;
  const intervalMs = options.intervalMs ?? 2000;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await fetchBulkSendStatus(eventId, batchId);
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
  addToast("Send is still running in the background. Check Communication for status.", "info");
}
