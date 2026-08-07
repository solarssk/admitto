import { ApiError, fetchImportJobStatus } from "../api/client.js";
import type { ImportCommitResponse } from "../api/types.js";

const DEFAULT_POLL_ATTEMPTS = 90;
const DEFAULT_POLL_INTERVAL_MS = 2000;

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** Abortable delay used between import job status polls. */
export function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export type WaitForImportJobResultOptions = {
  maxAttempts?: number;
  intervalMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

/** Poll worker job until succeeded result, failed, or poll budget exhausted. */
export async function waitForImportJobResult(
  eventId: string,
  jobId: string,
  signal: AbortSignal,
  options: WaitForImportJobResultOptions = {},
): Promise<ImportCommitResponse> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_POLL_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? sleepWithAbort;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const status = await fetchImportJobStatus(eventId, jobId, signal);
    if (status.status === "succeeded") {
      if (status.result) return status.result;
      throw new ApiError(500, "Import finished without a result.");
    }
    if (status.status === "failed") {
      throw new ApiError(500, status.error || "Import failed.");
    }
    if (attempt < maxAttempts - 1) {
      await sleep(intervalMs, signal);
    }
  }
  throw new ApiError(
    504,
    "Import is still running. Check history later or keep the worker running.",
  );
}
