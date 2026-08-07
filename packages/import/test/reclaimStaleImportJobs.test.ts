import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import type { StorageAdapter } from "@admitto/storage";
import {
  DEFAULT_IMPORT_JOB_STALE_RUNNING_MS,
  importResultJsonFromAuditMetadata,
  parseImportJobStaleRunningMs,
  reclaimStaleImportJobs,
  STALE_IMPORT_JOB_ERROR,
  STALE_IMPORT_PENDING_ERROR,
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
    status?: "pending" | "running";
    event_id?: string | null;
    import_id?: string | null;
    filename?: string | null;
  }>,
  opts: {
    updateCounts?: number[];
    importLanded?: boolean;
    auditMetadata?: Record<string, unknown>;
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
          status: j.status ?? "running",
          event_id: j.event_id ?? "evt-1",
          import_id: j.import_id ?? "imp-1",
          filename: j.filename ?? "a.csv",
          ...j,
        })),
      ),
      updateMany,
    },
    attendeeActionLog: {
      findFirst: vi.fn().mockResolvedValue(
        opts.importLanded
          ? {
              metadata: opts.auditMetadata ?? {
                created: 2,
                updated: 1,
                skipped: 3,
                filename: "a.csv",
                importId: "imp-1",
              },
            }
          : null,
      ),
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

describe("importResultJsonFromAuditMetadata", () => {
  it("maps audit counts into a pollable ImportCommitDto shape", () => {
    expect(
      importResultJsonFromAuditMetadata("imp-9", {
        created: 4,
        updated: 2,
        skipped: 1,
        filename: "x.csv",
      }),
    ).toEqual({
      importId: "imp-9",
      toCreate: 4,
      toUpdate: 2,
      toSkip: 1,
      created: 4,
      updated: 2,
      skipped: [],
      skippedCount: 1,
      invalidRows: [],
      invalidCount: 0,
    });
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
        OR: [
          { status: "running", started_at: { lt: new Date(now.getTime() - 60_000) } },
          { status: "pending", created_at: { lt: new Date(now.getTime() - 60_000) } },
        ],
      },
      select: {
        id: true,
        status: true,
        storage_key: true,
        event_id: true,
        import_id: true,
        filename: true,
      },
      orderBy: { created_at: "asc" },
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

  it("fails stale pending jobs that were never claimed", async () => {
    const deleted: string[] = [];
    const storage = mockStorage(deleted);
    const now = new Date("2026-08-07T12:00:00.000Z");
    const db = dbWithJobs([{ id: "job-pending", storage_key: "imports/evt/p.csv", status: "pending" }]);

    await expect(
      reclaimStaleImportJobs(db, storage, { olderThanMs: 60_000, now }),
    ).resolves.toEqual({ reclaimed: 1, healed: 0 });
    expect(db.attendeeActionLog.findFirst).not.toHaveBeenCalled();
    expect(db.adminJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-pending", status: "pending" },
      data: {
        status: "failed",
        error: STALE_IMPORT_PENDING_ERROR,
        finished_at: now,
      },
    });
    expect(deleted).toEqual(["imports/evt/p.csv"]);
  });

  it("heals to succeeded with result_json when attendees_imported already landed", async () => {
    const deleted: string[] = [];
    const storage = mockStorage(deleted);
    const now = new Date("2026-08-07T12:00:00.000Z");
    const db = dbWithJobs(
      [{ id: "job-done", storage_key: "imports/evt/a.csv", import_id: "imp-done" }],
      {
        importLanded: true,
        auditMetadata: {
          created: 5,
          updated: 2,
          skipped: 1,
          filename: "a.csv",
          importId: "imp-done",
        },
      },
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
        created_count: 5,
        updated_count: 2,
        skipped_count: 1,
        result_json: {
          importId: "imp-done",
          toCreate: 5,
          toUpdate: 2,
          toSkip: 1,
          created: 5,
          updated: 2,
          skipped: [],
          skippedCount: 1,
          invalidRows: [],
          invalidCount: 0,
        },
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
    const dbOmit = dbWithJobs([{ id: "job-null-key", storage_key: null }]);
    const dbZero = dbWithJobs([{ id: "job-null-key-2", storage_key: null }]);

    const before = Date.now();
    expect(await reclaimStaleImportJobs(dbOmit, storage)).toEqual({ reclaimed: 1, healed: 0 });
    expect(await reclaimStaleImportJobs(dbZero, storage, { olderThanMs: 0 })).toEqual({
      reclaimed: 1,
      healed: 0,
    });
    const after = Date.now();

    expect(deleteFn).not.toHaveBeenCalled();
    for (const db of [dbOmit, dbZero]) {
      const where = (db.adminJob.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0].where;
      const runningCutoff = where.OR[0].started_at.lt as Date;
      expect(runningCutoff.getTime()).toBeGreaterThanOrEqual(before - DEFAULT_IMPORT_JOB_STALE_RUNNING_MS);
      expect(runningCutoff.getTime()).toBeLessThanOrEqual(after - DEFAULT_IMPORT_JOB_STALE_RUNNING_MS);
    }
  });

  it("does not treat missing event_id or import_id as an already-committed import", async () => {
    const storage = mockStorage();
    const dbMissingEvent = dbWithJobs([
      { id: "job-no-event", storage_key: "k", event_id: null, import_id: "imp-1" },
    ]);
    const dbMissingImport = dbWithJobs([
      { id: "job-no-import", storage_key: "k", event_id: "evt-1", import_id: null },
    ]);

    await expect(
      reclaimStaleImportJobs(dbMissingEvent, storage, { olderThanMs: 1, now: new Date() }),
    ).resolves.toEqual({ reclaimed: 1, healed: 0 });
    await expect(
      reclaimStaleImportJobs(dbMissingImport, storage, { olderThanMs: 1, now: new Date() }),
    ).resolves.toEqual({ reclaimed: 1, healed: 0 });
    expect(dbMissingEvent.attendeeActionLog.findFirst).not.toHaveBeenCalled();
    expect(dbMissingImport.attendeeActionLog.findFirst).not.toHaveBeenCalled();
  });
});
