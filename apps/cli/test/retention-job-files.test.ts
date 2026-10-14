import { afterEach, describe, expect, it, vi } from "vitest";

const storage = { name: "default-storage" };
const purgeJobFiles = vi.fn(async (..._args: unknown[]) => ({ exportFiles: 3, stagedImportFiles: 1, failures: 0 }));
const sweepOrphanedJobFiles = vi.fn(async (..._args: unknown[]) => ({
  scanned: 5,
  named: 3,
  tooNew: 0,
  deleted: 2,
  failed: 0,
}));
vi.mock("@admitto/storage", async (importActual) => ({
  ...(await importActual<typeof import("@admitto/storage")>()),
  getDefaultStorage: () => storage,
  purgeJobFiles,
  sweepOrphanedJobFiles,
}));

const { purgeJobFilesForRetention } = await import("../src/lib/retention-job-files.js");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  purgeJobFiles.mockClear();
  sweepOrphanedJobFiles.mockClear();
});

describe("purgeJobFilesForRetention", () => {
  it("purges the default storage with the windows from the environment, sweeps it for files no job names, and returns the counts", async () => {
    vi.stubEnv("EXPORT_FILE_RETENTION_DAYS", "3");
    vi.stubEnv("IMPORT_STAGED_FILE_RETENTION_DAYS", "14");
    const db = {} as never;

    const result = await purgeJobFilesForRetention(db, false);

    expect(result).toEqual({ exportFiles: 3, stagedImportFiles: 1, orphanedFiles: 2, failures: 0 });
    expect(purgeJobFiles).toHaveBeenCalledWith(db, storage, {
      dryRun: false,
      exportRetentionDays: 3,
      stagedImportRetentionDays: 14,
    });
    expect(sweepOrphanedJobFiles).toHaveBeenCalledWith(db, storage, { dryRun: false });
  });

  it("passes a dry run on to both, and keeps both windows at 7 days when nothing is set", async () => {
    vi.stubEnv("EXPORT_FILE_RETENTION_DAYS", "");
    vi.stubEnv("IMPORT_STAGED_FILE_RETENTION_DAYS", "");

    await purgeJobFilesForRetention({} as never, true);

    expect(purgeJobFiles).toHaveBeenCalledWith(expect.anything(), storage, {
      dryRun: true,
      exportRetentionDays: 7,
      stagedImportRetentionDays: 7,
    });
    expect(sweepOrphanedJobFiles).toHaveBeenCalledWith(expect.anything(), storage, { dryRun: true });
  });

  it("adds the files that the sweep could not delete to the failures of the purge", async () => {
    purgeJobFiles.mockResolvedValueOnce({ exportFiles: 0, stagedImportFiles: 0, failures: 1 });
    sweepOrphanedJobFiles.mockResolvedValueOnce({ scanned: 4, named: 1, tooNew: 0, deleted: 1, failed: 2 });

    const result = await purgeJobFilesForRetention({} as never, false);

    expect(result).toEqual({ exportFiles: 0, stagedImportFiles: 0, orphanedFiles: 1, failures: 3 });
  });

  it("counts a sweep that breaks as one failure, keeps what the purge did, and does not throw", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    sweepOrphanedJobFiles.mockRejectedValueOnce(new Error("EACCES: permission denied"));

    const result = await purgeJobFilesForRetention({} as never, false);

    expect(result).toEqual({ exportFiles: 3, stagedImportFiles: 1, orphanedFiles: 0, failures: 1 });
    expect(errorLog).toHaveBeenCalledWith("orphaned job file sweep failed:", expect.any(Error));
  });
});
