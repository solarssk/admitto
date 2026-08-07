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
    const findMany = vi.fn().mockResolvedValue([
      { id: "job-old", storage_key: "imports/evt/a.csv" },
      { id: "job-race", storage_key: "imports/evt/b.csv" },
    ]);
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const db = {
      adminJob: { findMany, updateMany },
    } as unknown as PrismaClient;

    const result = await reclaimStaleImportJobs(db, storage, {
      olderThanMs: 60_000,
      now,
    });

    expect(result).toEqual({ reclaimed: 1 });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        type: "import_commit",
        status: "running",
        started_at: { lt: new Date(now.getTime() - 60_000) },
      },
      select: { id: true, storage_key: true },
      orderBy: { started_at: "asc" },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "job-old", status: "running" },
      data: {
        status: "failed",
        error: STALE_IMPORT_JOB_ERROR,
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
    const db = {
      adminJob: {
        findMany: vi.fn().mockResolvedValue([{ id: "job-1", storage_key: "k" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as PrismaClient;

    await expect(
      reclaimStaleImportJobs(db, storage, { olderThanMs: 1, now: new Date() }),
    ).resolves.toEqual({ reclaimed: 1 });
  });
});
