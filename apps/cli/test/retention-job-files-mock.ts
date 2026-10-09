import { vi } from "vitest";

/**
 * Stand-in for `../src/lib/retention-job-files.js` in the tests that run the real worker or retention
 * command but are not about the files that jobs leave in storage: no files, nothing deleted. Used as
 * `vi.mock("../src/lib/retention-job-files.js", async () => (await import("./retention-job-files-mock.js")).mock)`.
 */
export const mock = {
  purgeJobFilesForRetention: vi.fn(async () => ({ exportFiles: 0, stagedImportFiles: 0, failures: 0 })),
};
