import { vi } from "vitest";

/**
 * Stand-in for `../src/lib/retention-job-files.js` in the tests that run the real worker or retention
 * command but are not about the files that jobs leave in storage: no files, nothing deleted. Used as
 * `vi.mock("../src/lib/retention-job-files.js", async () => (await import("./retention-job-files-mock.js")).mock)`.
 */
export const mock = {
  purgeJobFilesForRetention: vi.fn(async () => ({ exportFiles: 0, stagedImportFiles: 0, failures: 0 })),
};

/**
 * The same for `../src/lib/retention-erased-wallet-passes.js` (the sweep of wallet passes of erased attendees):
 * nothing pending, nothing deleted, the rest of the module real. Used as
 * `vi.mock("../src/lib/retention-erased-wallet-passes.js", async () => (await import("./retention-job-files-mock.js")).sweepMock())`.
 */
export async function sweepMock() {
  const actual = await vi.importActual<typeof import("../src/lib/retention-erased-wallet-passes.js")>(
    "../src/lib/retention-erased-wallet-passes.js",
  );
  return {
    ...actual,
    sweepErasedWalletPasses: vi.fn(async () => ({ pending: 0, deleted: 0, failed: 0, noProvider: 0, notTried: 0 })),
  };
}
