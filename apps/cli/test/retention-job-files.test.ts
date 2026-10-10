import { afterEach, describe, expect, it, vi } from "vitest";

const storage = { name: "default-storage" };
const purgeJobFiles = vi.fn(async (..._args: unknown[]) => ({ exportFiles: 3, stagedImportFiles: 1, failures: 0 }));
vi.mock("@admitto/storage", async (importActual) => ({
  ...(await importActual<typeof import("@admitto/storage")>()),
  getDefaultStorage: () => storage,
  purgeJobFiles,
}));

const { purgeJobFilesForRetention } = await import("../src/lib/retention-job-files.js");

afterEach(() => {
  vi.unstubAllEnvs();
  purgeJobFiles.mockClear();
});

describe("purgeJobFilesForRetention", () => {
  it("purges the default storage with the windows from the environment and returns the counts", async () => {
    vi.stubEnv("EXPORT_FILE_RETENTION_DAYS", "3");
    vi.stubEnv("IMPORT_STAGED_FILE_RETENTION_DAYS", "14");
    const db = {} as never;

    const result = await purgeJobFilesForRetention(db, false);

    expect(result).toEqual({ exportFiles: 3, stagedImportFiles: 1, failures: 0 });
    expect(purgeJobFiles).toHaveBeenCalledWith(db, storage, {
      dryRun: false,
      exportRetentionDays: 3,
      stagedImportRetentionDays: 14,
    });
  });

  it("passes a dry run on, and keeps both windows at 7 days when nothing is set", async () => {
    vi.stubEnv("EXPORT_FILE_RETENTION_DAYS", "");
    vi.stubEnv("IMPORT_STAGED_FILE_RETENTION_DAYS", "");

    await purgeJobFilesForRetention({} as never, true);

    expect(purgeJobFiles).toHaveBeenCalledWith(expect.anything(), storage, {
      dryRun: true,
      exportRetentionDays: 7,
      stagedImportRetentionDays: 7,
    });
  });
});
