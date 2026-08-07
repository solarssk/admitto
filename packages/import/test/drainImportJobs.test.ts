import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/reclaimStaleImportJobs.js", () => ({
  parseImportJobStaleRunningMs: vi.fn(() => 60_000),
  reclaimStaleImportJobs: vi.fn(),
}));
vi.mock("../src/executeImportCommit.js", () => ({
  executeImportCommit: vi.fn(),
  ImportCapacityExceededError: class ImportCapacityExceededError extends Error {},
}));

import { reclaimStaleImportJobs } from "../src/reclaimStaleImportJobs.js";
import { executeImportCommit } from "../src/executeImportCommit.js";
import { drainImportJobs } from "../src/drainImportJobs.js";

describe("drainImportJobs", () => {
  const storage = {
    get: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.mocked(reclaimStaleImportJobs).mockReset().mockResolvedValue({ reclaimed: 0, healed: 0 });
    vi.mocked(executeImportCommit).mockReset();
    storage.get.mockReset();
    storage.delete.mockReset().mockResolvedValue(undefined);
  });

  it("reclaims stale running jobs before claiming pending work", async () => {
    vi.mocked(reclaimStaleImportJobs).mockResolvedValue({ reclaimed: 2, healed: 1 });
    const db = {
      adminJob: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        update: vi.fn(),
      },
    };

    await expect(drainImportJobs(db as never, storage as never, { limit: 1 })).resolves.toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 0,
      reclaimed: 2,
      healed: 1,
    });
    expect(reclaimStaleImportJobs).toHaveBeenCalledWith(
      db,
      storage,
      expect.objectContaining({ olderThanMs: 60_000 }),
    );
    expect(db.adminJob.findFirst).toHaveBeenCalled();
  });
});
