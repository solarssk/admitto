import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import type { StorageAdapter } from "@admitto/storage";
import {
  DEFAULT_IMPORT_JOB_STALE_RUNNING_MS,
  parseImportJobStaleRunningMs,
  reclaimStaleImportJobs,
  STALE_IMPORT_JOB_ERROR,
} from "../src/reclaimStaleImportJobs.js";

function mockStorage(deleted: string[] = []): StorageAdapter {
  return {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(async (key: string) => {
      deleted.push(key);
    }),
    exists: vi.fn(),
  } as unknown as StorageAdapter;
}

function dbWithJobs(
  jobs: Array<{
    id: string;
    storage_key: string | null;
    event_id?: string | null;
    import_id?: string | null;
  }>,
  opts: {
    updateCounts?: number[];
    importLanded?: boolean;
  } = {},
): PrismaClient {
  const updateMany = vi.fn();
  for (const count of opts.updateCounts ?? jobs.map(() => 1)) {
    updateMany.mockResolvedValueOnce({ count });
  }
  return {
    adminJob: {
      findMany: vi.fn().mockResolvedValue(
        jobs.map((j) => ({
          event_id: j.event_id ?? "evt-1",
          import_id: j.import_id ?? "imp-1",
          ...j,
        })),
      ),
      updateMany,
    },
    attendeeActionLog: {
      findFirst: vi.fn().mockResolvedValue(opts.importLanded ? { id: "log-1" } : null),
    },
  } as unknown as PrismaClient;
}

describe("parseImportJobStaleRunningMs", () => {
  it("returns default when unset or invalid", () => {
    expect(parseImportJobStaleRunningMs({})).toBe(DEFAULT_IMPORT_JOB_STALE_RUNNING_MS);
    expect(parseImportJobStaleRunningMs({ IMPORT_JOB_STALE_RUNNING_MS: "" })).toBe(
      DEFAULT_IMPORT_JOB_STALE_RUNNING_MS,
    );
    expect(parseImportJobStaleRunningMs({ IMPORT_JOB_STALE_RUNNING_MS: "0" })).toBe(
      DEFAULT_IMPORT_JOB_STALE_RUNNING_MS,
    );
    expect(parseImportJobStaleRunningMs({ IMPORT_JOB_STALE_RUNNING_MS: "-1" })).toBe(
      DEFAULT_IMPORT_JOB_STALE_RUNNING_MS,
    );
    expect(parseImportJobStaleRunningMs({ IMPORT_JOB_STALE_RUNNING_MS: "nope" })).toBe(
      DEFAULT_IMPORT_JOB_STALE_RUNNING_MS,
    );
  });

  it("parses a positive integer", () => {
    expect(parseImportJobStaleRunningMs({ IMPORT_JOB_STALE_RUNNING_MS: "600000" })).toBe(600_000);
  });
});

describe("reclaimStaleImportJobs", () => {
  it("fails stale running import_commit jobs and deletes staged keys", async () => {
    const deleted: string[] = [];
    const storage = mockStorage(deleted);
    const now = new Date("2026-08-07T12:00:00.000Z");
    const db = dbWithJobs(
      [
        { id: "job-old", storage_key: "imports/evt/a.csv" },
        { id: "job-race", storage_key: "imports/evt/b.csv" },
      ],
      { updateCounts: [1, 0] },
    );

    const result = await reclaimStaleImportJobs(db, storage, {
      olderThanMs: 60_000,
      now,
    });

    expect(result).toEqual({ reclaimed: 1, healed: 0 });
    expect(db.adminJob.findMany).toHaveBeenCalledWith({
      where: {
        type: "import_commit",
        status: "running",
        started_at: { lt: new Date(now.getTime() - 60_000) },
      },
      select: { id: true, storage_key: true, event_id: true, import_id: true },
      orderBy: { started_at: "asc" },
    });
    expect(db.adminJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-old", status: "running" },
      data: {
        status: "failed",
        error: STALE_IMPORT_JOB_ERROR,
        finished_at: now,
      },
    });
    expect(deleted).toEqual(["imports/evt/a.csv"]);
  });

  it("heals to succeeded when attendees_imported already landed", async () => {
    const deleted: string[] = [];
    const storage = mockStorage(deleted);
    const now = new Date("2026-08-07T12:00:00.000Z");
    const db = dbWithJobs(
      [{ id: "job-done", storage_key: "imports/evt/a.csv", import_id: "imp-done" }],
      { importLanded: true },
    );

    await expect(
      reclaimStaleImportJobs(db, storage, { olderThanMs: 60_000, now }),
    ).resolves.toEqual({ reclaimed: 0, healed: 1 });
    expect(db.adminJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-done", status: "running" },
      data: {
        status: "succeeded",
        error: null,
        finished_at: now,
      },
    });
    expect(deleted).toEqual(["imports/evt/a.csv"]);
  });

  it("ignores delete errors on staged CSV", async () => {
    const storage = {
      delete: vi.fn(async () => {
        throw new Error("gone");
      }),
    } as unknown as StorageAdapter;
    const db = dbWithJobs([{ id: "job-1", storage_key: "k" }]);

    await expect(
      reclaimStaleImportJobs(db, storage, { olderThanMs: 1, now: new Date() }),
    ).resolves.toEqual({ reclaimed: 1, healed: 0 });
  });

  it("uses default stale window and clock when options omit them", async () => {
    const deleteFn = vi.fn(async () => {});
    const storage = { delete: deleteFn } as unknown as StorageAdapter;
    const db = dbWithJobs([{ id: "job-null-key", storage_key: null }]);

    const before = Date.now();
    const result = await reclaimStaleImportJobs(db, storage, { olderThanMs: 0 });
    const after = Date.now();

    expect(result).toEqual({ reclaimed: 1, healed: 0 });
    expect(deleteFn).not.toHaveBeenCalled();
    const cutoff = (db.adminJob.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0].where
      .started_at.lt as Date;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - DEFAULT_IMPORT_JOB_STALE_RUNNING_MS);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - DEFAULT_IMPORT_JOB_STALE_RUNNING_MS);
  });

  it("does not treat missing event_id or import_id as an already-committed import", async () => {
    const storage = mockStorage();
    const db = dbWithJobs([{ id: "job-orphan", storage_key: "k", event_id: null, import_id: null }]);

    await expect(
      reclaimStaleImportJobs(db, storage, { olderThanMs: 1, now: new Date() }),
    ).resolves.toEqual({ reclaimed: 1, healed: 0 });
    expect(db.attendeeActionLog.findFirst).not.toHaveBeenCalled();
  });
});
