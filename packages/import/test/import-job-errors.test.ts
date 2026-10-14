import { describe, expect, it } from "vitest";
import { IMPORT_STOPPED_BY_ERASURE_ERROR } from "@admitto/tickets";
import { IMPORT_CAPACITY_ERROR, IMPORT_JOB_FAILED_ERROR, safeImportJobError } from "../src/import-job-errors.js";
import { STALE_IMPORT_JOB_ERROR, STALE_IMPORT_PENDING_ERROR } from "../src/reclaimStaleImportJobs.js";

describe("safe import job errors", () => {
  it.each([
    IMPORT_JOB_FAILED_ERROR, IMPORT_CAPACITY_ERROR, IMPORT_STOPPED_BY_ERASURE_ERROR,
    STALE_IMPORT_JOB_ERROR, STALE_IMPORT_PENDING_ERROR,
    "Import stopped before it finished.", "import_job_incomplete",
  ])("preserves the fixed category %s", (error) => {
    expect(safeImportJobError(error)).toBe(error);
    expect(safeImportJobError(`${error} private@example.com`)).toBe(IMPORT_JOB_FAILED_ERROR);
  });

  it("recognizes old numeric capacity failures without forwarding the stored message", () => {
    const oldCapacity = "Import would exceed capacity. 8 existing + 3 new = 11 > 10.";
    expect(safeImportJobError(oldCapacity)).toBe(IMPORT_CAPACITY_ERROR);
    expect(safeImportJobError(`${oldCapacity} private@example.com`)).toBe(IMPORT_JOB_FAILED_ERROR);
    expect(safeImportJobError("Import would exceed capacity. private@example.com")).toBe(IMPORT_JOB_FAILED_ERROR);
  });

  it("hides arbitrary old exceptions and leaves absent errors absent", () => {
    expect(safeImportJobError("SQL arguments: private@example.com")).toBe(IMPORT_JOB_FAILED_ERROR);
    expect(safeImportJobError("unexpected failure without an address")).toBe(IMPORT_JOB_FAILED_ERROR);
    expect(safeImportJobError(null)).toBeNull();
  });
});
