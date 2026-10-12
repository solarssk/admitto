import { EXPORT_STOPPED_BY_ERASURE_ERROR } from "./stop-open-jobs.js";
import { STALE_EXPORT_JOB_ERROR, STALE_EXPORT_PENDING_ERROR } from "./reclaim-stale-export-jobs.js";

export const EXPORT_JOB_FAILED_ERROR = "Export failed. Run the export again.";

const SAFE_EXPORT_ERRORS = new Set([
  EXPORT_JOB_FAILED_ERROR,
  EXPORT_STOPPED_BY_ERASURE_ERROR,
  STALE_EXPORT_JOB_ERROR,
  STALE_EXPORT_PENDING_ERROR,
  "export_job_incomplete",
  "export_job_bad_request",
  "export_too_large",
]);

/** Only fixed application messages may leave the job, including historical stored errors. */
export function safeExportJobError(error: string | null): string | null {
  if (error === null) return null;
  return SAFE_EXPORT_ERRORS.has(error) ? error : EXPORT_JOB_FAILED_ERROR;
}
