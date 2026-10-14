import { IMPORT_STOPPED_BY_ERASURE_ERROR } from "@admitto/tickets";
import { STALE_IMPORT_JOB_ERROR, STALE_IMPORT_PENDING_ERROR } from "./reclaimStaleImportJobs.js";

export const IMPORT_JOB_FAILED_ERROR = "Import failed. Upload the file again.";
export const IMPORT_CAPACITY_ERROR = "Import would exceed event capacity. Reduce the attendee count or review event capacity.";

const SAFE_IMPORT_ERRORS = new Set([
  IMPORT_JOB_FAILED_ERROR,
  IMPORT_CAPACITY_ERROR,
  IMPORT_STOPPED_BY_ERASURE_ERROR,
  STALE_IMPORT_JOB_ERROR,
  STALE_IMPORT_PENDING_ERROR,
  "Import stopped before it finished.",
  "import_job_incomplete",
]);

/** Project stored errors without rewriting history or publishing arbitrary exception text. */
export function safeImportJobError(error: string | null): string | null {
  if (error === null) return null;
  if (SAFE_IMPORT_ERRORS.has(error)) return error;
  // Earlier capacity failures used numeric counts. Match the entire known message, never a prefix.
  if (/^Import would exceed capacity\. \d+ existing \+ \d+ new = \d+ > \d+\.$/.test(error)) {
    return IMPORT_CAPACITY_ERROR;
  }
  return IMPORT_JOB_FAILED_ERROR;
}
