import { ApiError, fetchImportJobStatus } from "../api/client.js";
import type { ImportCommitResponse } from "../api/types.js";
import { sleepWithAbort } from "../lib/sleep-with-abort.js";

export { sleepWithAbort } from "../lib/sleep-with-abort.js";

/** Keep aligned with `DEFAULT_IMPORT_JOB_STALE_RUNNING_MS` / reclaim. */
export const IMPORT_JOB_CLIENT_STALE_MS = 15 * 60 * 1000;

const DEFAULT_POLL_INTERVAL_MS = 5000;
/** Safety cap so a clock skew cannot loop forever (≈5h at 5s). */
const DEFAULT_MAX_ATTEMPTS = 3600;

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export type WaitForImportJobResultOptions = {
  maxAttempts?: number;
  intervalMs?: number;
  staleMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

function jobStartedMs(status: { started_at?: string | null }): number | null {
  const raw = status.started_at;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/** Poll worker job until succeeded result, failed, or running stale window exhausted. */
export async function waitForImportJobResult(
  eventId: string,
  jobId: string,
  signal: AbortSignal,
  options: WaitForImportJobResultOptions = {},
): Promise<ImportCommitResponse> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const staleMs = options.staleMs ?? IMPORT_JOB_CLIENT_STALE_MS;
  const now = options.now ?? Date.now;
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
      // 422: application failure (not transport). Avoids the global "server unavailable" banner.
      throw new ApiError(422, status.error || "Import failed.");
    }
    // Only apply the stale window once the worker has claimed the job. Pure `pending`
    // can wait in a live backlog longer than the running threshold without meaning the
    // worker is gone (matches server reclaim: pending fail only when heartbeat is stale).
    const started = jobStartedMs(status);
    if (started != null && now() - started >= staleMs) {
      throw new ApiError(
        408,
        "Import is still running. Check history later or keep the worker running.",
      );
    }
    if (attempt < maxAttempts - 1) {
      await sleep(intervalMs, signal);
    }
  }
  throw new ApiError(
    408,
    "Import is still running. Check history later or keep the worker running.",
  );
}
