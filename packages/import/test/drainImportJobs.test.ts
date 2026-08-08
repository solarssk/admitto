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
import {
  executeImportCommit,
  ImportCapacityExceededError,
} from "../src/executeImportCommit.js";
import { drainImportJobs } from "../src/drainImportJobs.js";

function baseJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    event_id: "evt-1",
    storage_key: "imports/evt/a.csv",
    import_id: "imp-1",
    overwrite: false,
    force_capacity: false,
    actor_user_id: "user-1",
    session_id: "sess-1",
    client_timezone: "UTC",
    filename: "a.csv",
    ...overrides,
  };
}

describe("drainImportJobs", () => {
  const storage = {
    get: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  let db: {
    adminJob: {
      findFirst: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    vi.mocked(reclaimStaleImportJobs).mockReset().mockResolvedValue({ reclaimed: 0, healed: 0 });
    vi.mocked(executeImportCommit).mockReset();
    storage.get.mockReset().mockResolvedValue(Buffer.from("name,email\nA,a@example.com"));
    storage.delete.mockReset().mockResolvedValue(undefined);
    db = {
      adminJob: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
    };
  });

  it("reclaims stale running jobs before claiming pending work", async () => {
    vi.mocked(reclaimStaleImportJobs).mockResolvedValue({ reclaimed: 2, healed: 1 });

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

  it("claims a pending job, runs commit, and deletes the staged CSV", async () => {
    const job = baseJob();
    db.adminJob.findFirst.mockResolvedValueOnce(job).mockResolvedValue(null);
    db.adminJob.findUniqueOrThrow.mockResolvedValue(job);
    vi.mocked(executeImportCommit).mockResolvedValue({} as never);

    await expect(drainImportJobs(db as never, storage as never)).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
      reclaimed: 0,
      healed: 0,
    });
    expect(executeImportCommit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        eventId: "evt-1",
        importId: "imp-1",
        adminJobId: "job-1",
        csv: expect.stringContaining("a@example.com"),
      }),
    );
    expect(storage.delete).toHaveBeenCalledWith("imports/evt/a.csv");
  });

  it("swallows staged CSV delete errors after a successful commit", async () => {
    const job = baseJob();
    db.adminJob.findFirst.mockResolvedValueOnce(job).mockResolvedValue(null);
    db.adminJob.findUniqueOrThrow.mockResolvedValue(job);
    vi.mocked(executeImportCommit).mockResolvedValue({} as never);
    storage.delete.mockRejectedValue(new Error("gone"));

    await expect(drainImportJobs(db as never, storage as never)).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
      reclaimed: 0,
      healed: 0,
    });
  });

  it("marks the job failed when commit throws", async () => {
    const job = baseJob();
    db.adminJob.findFirst.mockResolvedValueOnce(job).mockResolvedValue(null);
    db.adminJob.findUniqueOrThrow.mockResolvedValue(job);
    vi.mocked(executeImportCommit).mockRejectedValue(new Error("boom"));

    await expect(drainImportJobs(db as never, storage as never)).resolves.toEqual({
      claimed: 1,
      succeeded: 0,
      failed: 1,
      reclaimed: 0,
      healed: 0,
    });
    expect(db.adminJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({ status: "failed", error: "boom" }),
      }),
    );
  });

  it("uses ImportCapacityExceededError message when marking failed", async () => {
    const job = baseJob();
    db.adminJob.findFirst.mockResolvedValueOnce(job).mockResolvedValue(null);
    db.adminJob.findUniqueOrThrow.mockResolvedValue(job);
    vi.mocked(executeImportCommit).mockRejectedValue(
      new ImportCapacityExceededError("capacity_blocked"),
    );

    await expect(drainImportJobs(db as never, storage as never)).resolves.toMatchObject({
      failed: 1,
    });
    expect(db.adminJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ error: "capacity_blocked" }),
      }),
    );
  });

  it("stringifies non-Error failures when marking the job failed", async () => {
    const job = baseJob();
    db.adminJob.findFirst.mockResolvedValueOnce(job).mockResolvedValue(null);
    db.adminJob.findUniqueOrThrow.mockResolvedValue(job);
    vi.mocked(executeImportCommit).mockRejectedValue("plain-fail");

    await expect(drainImportJobs(db as never, storage as never)).resolves.toMatchObject({
      failed: 1,
    });
    expect(db.adminJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ error: "plain-fail" }),
      }),
    );
  });

  it("fails incomplete jobs without calling executeImportCommit", async () => {
    const job = baseJob({ event_id: null });
    db.adminJob.findFirst.mockResolvedValueOnce(job).mockResolvedValue(null);
    db.adminJob.findUniqueOrThrow.mockResolvedValue(job);

    await expect(drainImportJobs(db as never, storage as never)).resolves.toEqual({
      claimed: 1,
      succeeded: 0,
      failed: 1,
      reclaimed: 0,
      healed: 0,
    });
    expect(executeImportCommit).not.toHaveBeenCalled();
    expect(db.adminJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ error: "import_job_incomplete" }),
      }),
    );
  });

  it("skips a job lost to a claim race and keeps searching", async () => {
    const job = baseJob();
    db.adminJob.findFirst.mockResolvedValueOnce(job).mockResolvedValue(null);
    db.adminJob.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(drainImportJobs(db as never, storage as never, { limit: 2 })).resolves.toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 0,
      reclaimed: 0,
      healed: 0,
    });
    expect(executeImportCommit).not.toHaveBeenCalled();
  });

  it("floors a positive limit and defaults invalid limits to 1", async () => {
    const jobA = baseJob({ id: "job-a" });
    const jobB = baseJob({ id: "job-b" });
    db.adminJob.findFirst
      .mockResolvedValueOnce(jobA)
      .mockResolvedValueOnce(jobB)
      .mockResolvedValue(null);
    db.adminJob.findUniqueOrThrow.mockResolvedValueOnce(jobA).mockResolvedValueOnce(jobB);
    vi.mocked(executeImportCommit).mockResolvedValue({} as never);

    await expect(drainImportJobs(db as never, storage as never, { limit: 2.9 })).resolves.toEqual({
      claimed: 2,
      succeeded: 2,
      failed: 0,
      reclaimed: 0,
      healed: 0,
    });

    db.adminJob.findFirst.mockClear().mockResolvedValue(null);
    await drainImportJobs(db as never, storage as never, { limit: 0 });
    expect(db.adminJob.findFirst).toHaveBeenCalledTimes(1);
  });
});
