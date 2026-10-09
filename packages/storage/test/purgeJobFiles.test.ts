import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import {
  DEFAULT_EXPORT_FILE_RETENTION_DAYS,
  DEFAULT_STAGED_IMPORT_RETENTION_DAYS,
  LocalStorageAdapter,
  purgeEventExportFiles,
  purgeJobFiles,
  resolveExportFileRetentionDays,
  resolveStagedImportRetentionDays,
  type StorageAdapter,
} from "../src/index.js";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

type Row = {
  id: string;
  type: string;
  event_id: string | null;
  storage_key: string | null;
  finished_at: Date | null;
};

type Where = {
  type?: string;
  event_id?: string;
  finished_at?: { lte: Date };
  storage_key?: { not: null } | string;
  id?: { gt: string } | string;
};

/** Just enough of `adminJob` for the where clauses the purge uses, over rows in memory. */
function fakeDb(rows: Row[]): PrismaClient {
  // No honest walk reads this many pages: a loop that does not advance fails here instead of hanging the suite.
  let reads = 0;
  const matches = (row: Row, where: Where): boolean => {
    if (where.type !== undefined && row.type !== where.type) return false;
    if (where.event_id !== undefined && row.event_id !== where.event_id) return false;
    if (where.finished_at !== undefined && (row.finished_at === null || row.finished_at > where.finished_at.lte)) return false;
    if (typeof where.storage_key === "string" && row.storage_key !== where.storage_key) return false;
    if (typeof where.storage_key === "object" && row.storage_key === null) return false;
    if (typeof where.id === "string" && row.id !== where.id) return false;
    if (typeof where.id === "object" && !(row.id > where.id.gt)) return false;
    return true;
  };
  return {
    adminJob: {
      findMany: vi.fn(async ({ where, take }: { where: Where; take: number }) => {
        if (++reads > 50) throw new Error("the walk does not advance");
        return rows
          .filter((row) => matches(row, where))
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, take)
          .map((row) => ({ id: row.id, storage_key: row.storage_key }));
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: { storage_key: null } }) => {
        const hit = rows.filter((row) => matches(row, where));
        for (const row of hit) row.storage_key = data.storage_key;
        return { count: hit.length };
      }),
    },
  } as unknown as PrismaClient;
}

describe("purgeJobFiles", () => {
  let uploadDir: string;
  let storage: LocalStorageAdapter;

  beforeEach(() => {
    uploadDir = mkdtempSync(join(tmpdir(), "admitto-job-files-"));
    storage = new LocalStorageAdapter({ UPLOAD_DIR: uploadDir });
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  async function stored(ext: string, eventId = "evt-1"): Promise<string> {
    const { key } = await storage.put(Buffer.from("name,email\nA B,a@example.com\n"), {
      orgId: "org-1",
      eventId,
      scope: "event",
      ext,
    });
    return key;
  }
  const onDisk = (key: string) => existsSync(join(uploadDir, key));

  it("deletes the file of an export older than the window, keeps a newer one, and clears only the key", async () => {
    const oldKey = await stored(".csv");
    const newKey = await stored(".xlsx");
    const rows: Row[] = [
      { id: "j1", type: "export", event_id: "evt-1", storage_key: oldKey, finished_at: daysAgo(8) },
      { id: "j2", type: "export", event_id: "evt-1", storage_key: newKey, finished_at: daysAgo(6) },
    ];

    const result = await purgeJobFiles(fakeDb(rows), storage, { dryRun: false, now: NOW });

    expect(result).toEqual({ exportFiles: 1, stagedImportFiles: 0, failures: 0 });
    expect(onDisk(oldKey)).toBe(false);
    expect(onDisk(newKey)).toBe(true);
    expect(rows.map((row) => row.storage_key)).toEqual([null, newKey]);
    expect(rows).toHaveLength(2);
  });

  it("counts the window from the current time when no clock is given", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const oldKey = await stored(".csv");
    const newKey = await stored(".csv");
    const rows: Row[] = [
      { id: "j1", type: "export", event_id: "evt-1", storage_key: oldKey, finished_at: daysAgo(8) },
      { id: "j2", type: "export", event_id: "evt-1", storage_key: newKey, finished_at: daysAgo(6) },
    ];

    const result = await purgeJobFiles(fakeDb(rows), storage, { dryRun: false });

    expect(result.exportFiles).toBe(1);
    expect(onDisk(oldKey)).toBe(false);
    expect(onDisk(newKey)).toBe(true);
  });

  it("deletes the staged CSV of a finished import job (failed, or whose cleanup failed) after the window", async () => {
    const failedKey = await stored(".csv");
    const leftoverKey = await stored(".csv");
    const freshKey = await stored(".csv");
    const rows: Row[] = [
      { id: "j1", type: "import_commit", event_id: "evt-1", storage_key: failedKey, finished_at: daysAgo(30) },
      { id: "j2", type: "import_commit", event_id: "evt-1", storage_key: leftoverKey, finished_at: daysAgo(7) },
      { id: "j3", type: "import_commit", event_id: "evt-1", storage_key: freshKey, finished_at: daysAgo(1) },
    ];

    const result = await purgeJobFiles(fakeDb(rows), storage, { dryRun: false, now: NOW });

    expect(result).toEqual({ exportFiles: 0, stagedImportFiles: 2, failures: 0 });
    expect(onDisk(failedKey)).toBe(false);
    expect(onDisk(leftoverKey)).toBe(false);
    expect(onDisk(freshKey)).toBe(true);
  });

  it("never touches a job that has not finished, a job of another type, or one without a file", async () => {
    const runningKey = await stored(".csv");
    const otherKey = await stored(".csv");
    const rows: Row[] = [
      { id: "j1", type: "import_commit", event_id: "evt-1", storage_key: runningKey, finished_at: null },
      { id: "j2", type: "wallet_push", event_id: "evt-1", storage_key: otherKey, finished_at: daysAgo(90) },
      { id: "j3", type: "export", event_id: "evt-1", storage_key: null, finished_at: daysAgo(90) },
    ];

    const db = fakeDb(rows);

    const result = await purgeJobFiles(db, storage, { dryRun: false, now: NOW });

    expect(result).toEqual({ exportFiles: 0, stagedImportFiles: 0, failures: 0 });
    expect(onDisk(runningKey)).toBe(true);
    expect(onDisk(otherKey)).toBe(true);
    // Job rows stay for good once their file is gone, so a run must not read them again every time.
    expect(db.adminJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ storage_key: { not: null } }) }),
    );
  });

  it("only counts in a dry run, and deletes nothing", async () => {
    const key = await stored(".pdf");
    const rows: Row[] = [{ id: "j1", type: "export", event_id: "evt-1", storage_key: key, finished_at: daysAgo(40) }];
    const db = fakeDb(rows);

    const result = await purgeJobFiles(db, storage, { dryRun: true, now: NOW });

    expect(result.exportFiles).toBe(1);
    expect(onDisk(key)).toBe(true);
    expect(rows[0]!.storage_key).toBe(key);
    expect(db.adminJob.updateMany).not.toHaveBeenCalled();
  });

  it("uses the windows it is given, per kind of file", async () => {
    const exportKey = await stored(".csv");
    const stagedKey = await stored(".csv");
    const rows: Row[] = [
      { id: "j1", type: "export", event_id: "evt-1", storage_key: exportKey, finished_at: daysAgo(2) },
      { id: "j2", type: "import_commit", event_id: "evt-1", storage_key: stagedKey, finished_at: daysAgo(2) },
    ];

    const result = await purgeJobFiles(fakeDb(rows), storage, {
      dryRun: false,
      now: NOW,
      exportRetentionDays: 1,
      stagedImportRetentionDays: 30,
    });

    expect(result).toEqual({ exportFiles: 1, stagedImportFiles: 0, failures: 0 });
    expect(onDisk(exportKey)).toBe(false);
    expect(onDisk(stagedKey)).toBe(true);
  });

  it("falls back to the defaults for a window that is not a positive number", async () => {
    const key = await stored(".csv");
    const rows: Row[] = [{ id: "j1", type: "export", event_id: "evt-1", storage_key: key, finished_at: daysAgo(3) }];

    const result = await purgeJobFiles(fakeDb(rows), storage, {
      dryRun: false,
      now: NOW,
      exportRetentionDays: Number.NaN,
      stagedImportRetentionDays: -4,
    });

    // 3 days old is inside the default 7 days.
    expect(result.exportFiles).toBe(0);
    expect(onDisk(key)).toBe(true);
  });

  it("keeps the key of a file that could not be deleted, counts it, and carries on with the rest", async () => {
    const stuckKey = await stored(".csv");
    const otherKey = await stored(".csv");
    const stuckStagedKey = await stored(".csv");
    const rows: Row[] = [
      { id: "j1", type: "export", event_id: "evt-1", storage_key: stuckKey, finished_at: daysAgo(20) },
      { id: "j2", type: "export", event_id: "evt-1", storage_key: otherKey, finished_at: daysAgo(20) },
      { id: "j3", type: "import_commit", event_id: "evt-1", storage_key: stuckStagedKey, finished_at: daysAgo(20) },
    ];
    const failing: StorageAdapter = Object.create(storage, {
      delete: {
        value: async (key: string) => {
          if (key === stuckKey || key === stuckStagedKey) throw new Error("EBUSY");
          return storage.delete(key);
        },
      },
    });

    const result = await purgeJobFiles(fakeDb(rows), failing, { dryRun: false, now: NOW });

    expect(result).toEqual({ exportFiles: 1, stagedImportFiles: 0, failures: 2 });
    expect(rows.map((row) => row.storage_key)).toEqual([stuckKey, null, stuckStagedKey]);
    expect(onDisk(stuckKey)).toBe(true);
    expect(onDisk(stuckStagedKey)).toBe(true);
    expect(onDisk(otherKey)).toBe(false);
  });

  it("clears the key of a file that was already gone", async () => {
    const rows: Row[] = [
      {
        id: "j1",
        type: "export",
        event_id: "evt-1",
        storage_key: "org-1/events/evt-1/00000000-0000-0000-0000-000000000001.csv",
        finished_at: daysAgo(20),
      },
    ];

    const result = await purgeJobFiles(fakeDb(rows), storage, { dryRun: false, now: NOW });

    expect(result.exportFiles).toBe(1);
    expect(rows[0]!.storage_key).toBeNull();
  });

  it("leaves a key that changed while its file was being deleted", async () => {
    const key = await stored(".csv");
    const rows: Row[] = [{ id: "j1", type: "export", event_id: "evt-1", storage_key: key, finished_at: daysAgo(20) }];
    const racing: StorageAdapter = Object.create(storage, {
      delete: {
        value: async (k: string) => {
          rows[0]!.storage_key = "org-1/events/evt-1/another.csv";
          return storage.delete(k);
        },
      },
    });

    await purgeJobFiles(fakeDb(rows), racing, { dryRun: false, now: NOW });

    expect(rows[0]!.storage_key).toBe("org-1/events/evt-1/another.csv");
  });

  it("walks every page: more jobs than one page holds are all handled once", async () => {
    const rows: Row[] = Array.from({ length: 450 }, (_, i) => ({
      id: `job-${String(i).padStart(4, "0")}`,
      type: "export",
      event_id: "evt-1",
      storage_key: `org-1/events/evt-1/${i}.csv`,
      finished_at: daysAgo(30),
    }));
    const deleted: string[] = [];
    const stub = { delete: vi.fn(async (key: string) => (deleted.push(key), { deleted: true })) } as unknown as StorageAdapter;

    const result = await purgeJobFiles(fakeDb(rows), stub, { dryRun: false, now: NOW });

    expect(result.exportFiles).toBe(450);
    expect(deleted).toHaveLength(450);
    expect(new Set(deleted).size).toBe(450);
    expect(rows.every((row) => row.storage_key === null)).toBe(true);
  });

  it("moves past files that cannot be deleted: each is tried once and keeps its key, however many there are", async () => {
    const rows: Row[] = Array.from({ length: 450 }, (_, i) => ({
      id: `job-${String(i).padStart(4, "0")}`,
      type: "export",
      event_id: "evt-1",
      storage_key: `org-1/events/evt-1/${i}.csv`,
      finished_at: daysAgo(30),
    }));
    const tried: string[] = [];
    const stub = {
      delete: vi.fn(async (key: string) => {
        tried.push(key);
        throw new Error("EBUSY");
      }),
    } as unknown as StorageAdapter;

    const result = await purgeJobFiles(fakeDb(rows), stub, { dryRun: false, now: NOW });

    expect(result).toEqual({ exportFiles: 0, stagedImportFiles: 0, failures: 450 });
    expect(tried).toHaveLength(450);
    expect(new Set(tried).size).toBe(450);
    expect(rows.every((row) => row.storage_key !== null)).toBe(true);
  });

  it("walks every page in a dry run too, without deleting", async () => {
    const rows: Row[] = Array.from({ length: 250 }, (_, i) => ({
      id: `job-${String(i).padStart(4, "0")}`,
      type: "import_commit",
      event_id: "evt-1",
      storage_key: `org-1/events/evt-1/${i}.csv`,
      finished_at: daysAgo(30),
    }));
    const stub = { delete: vi.fn() } as unknown as StorageAdapter;

    const result = await purgeJobFiles(fakeDb(rows), stub, { dryRun: true, now: NOW });

    expect(result.stagedImportFiles).toBe(250);
    expect(stub.delete).not.toHaveBeenCalled();
  });
});

describe("purgeEventExportFiles", () => {
  let uploadDir: string;
  let storage: LocalStorageAdapter;

  beforeEach(() => {
    uploadDir = mkdtempSync(join(tmpdir(), "admitto-event-exports-"));
    storage = new LocalStorageAdapter({ UPLOAD_DIR: uploadDir });
  });

  afterEach(() => {
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it("deletes every export file of the event whatever its age, and nothing else", async () => {
    const put = async (eventId: string) =>
      (await storage.put(Buffer.from("x"), { orgId: "org-1", eventId, scope: "event", ext: ".csv" })).key;
    const [freshOfEvent, oldOfEvent, otherEvent, stagedImport] = [
      await put("evt-1"),
      await put("evt-1"),
      await put("evt-2"),
      await put("evt-1"),
    ];
    const rows: Row[] = [
      { id: "j1", type: "export", event_id: "evt-1", storage_key: freshOfEvent, finished_at: daysAgo(0) },
      { id: "j2", type: "export", event_id: "evt-1", storage_key: oldOfEvent, finished_at: daysAgo(200) },
      { id: "j3", type: "export", event_id: "evt-2", storage_key: otherEvent, finished_at: daysAgo(1) },
      { id: "j4", type: "import_commit", event_id: "evt-1", storage_key: stagedImport, finished_at: daysAgo(1) },
      { id: "j5", type: "export", event_id: "evt-1", storage_key: null, finished_at: null },
    ];

    const result = await purgeEventExportFiles(fakeDb(rows), storage, "evt-1");

    expect(result).toEqual({ deleted: 2, failed: 0 });
    expect(rows.map((row) => row.storage_key)).toEqual([null, null, otherEvent, stagedImport, null]);
    expect(existsSync(join(uploadDir, freshOfEvent))).toBe(false);
    expect(existsSync(join(uploadDir, otherEvent))).toBe(true);
    expect(existsSync(join(uploadDir, stagedImport))).toBe(true);
  });
});

describe("retention windows from the environment", () => {
  it("reads whole numbers, and falls back to 7 days for anything else", () => {
    expect(DEFAULT_EXPORT_FILE_RETENTION_DAYS).toBe(7);
    expect(DEFAULT_STAGED_IMPORT_RETENTION_DAYS).toBe(7);
    expect(resolveExportFileRetentionDays({})).toBe(7);
    expect(resolveExportFileRetentionDays({ EXPORT_FILE_RETENTION_DAYS: " 14 " })).toBe(14);
    expect(resolveExportFileRetentionDays({ EXPORT_FILE_RETENTION_DAYS: "0" })).toBe(7);
    expect(resolveExportFileRetentionDays({ EXPORT_FILE_RETENTION_DAYS: "-3" })).toBe(7);
    expect(resolveExportFileRetentionDays({ EXPORT_FILE_RETENTION_DAYS: "2.5" })).toBe(7);
    expect(resolveExportFileRetentionDays({ EXPORT_FILE_RETENTION_DAYS: "soon" })).toBe(7);
    expect(resolveStagedImportRetentionDays({})).toBe(7);
    expect(resolveStagedImportRetentionDays({ IMPORT_STAGED_FILE_RETENTION_DAYS: "1" })).toBe(1);
    expect(resolveStagedImportRetentionDays({ IMPORT_STAGED_FILE_RETENTION_DAYS: "" })).toBe(7);
  });

  it("caps an absurd window instead of failing the cutoff", () => {
    expect(resolveExportFileRetentionDays({ EXPORT_FILE_RETENTION_DAYS: "1000000000" })).toBe(36_500);
  });
});
