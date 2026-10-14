import { describe, expect, it } from "vitest";
import { EXPORT_JOB_FAILED_ERROR, safeExportJobError } from "../src/export-job-errors.js";
import { EXPORT_STOPPED_BY_ERASURE_ERROR } from "../src/stop-open-jobs.js";
import { STALE_EXPORT_JOB_ERROR, STALE_EXPORT_PENDING_ERROR } from "../src/reclaim-stale-export-jobs.js";

describe("safe export job errors", () => {
  it.each([
    EXPORT_JOB_FAILED_ERROR, EXPORT_STOPPED_BY_ERASURE_ERROR,
    STALE_EXPORT_JOB_ERROR, STALE_EXPORT_PENDING_ERROR,
    "export_job_incomplete", "export_job_bad_request", "export_too_large",
  ])("preserves the fixed category %s", (error) => {
    expect(safeExportJobError(error)).toBe(error);
    expect(safeExportJobError(`${error} private@example.com`)).toBe(EXPORT_JOB_FAILED_ERROR);
  });

  it("hides arbitrary old exceptions and leaves absent errors absent", () => {
    expect(safeExportJobError("SQL arguments: private@example.com")).toBe(EXPORT_JOB_FAILED_ERROR);
    expect(safeExportJobError("unexpected failure without an address")).toBe(EXPORT_JOB_FAILED_ERROR);
    expect(safeExportJobError(null)).toBeNull();
  });
});
