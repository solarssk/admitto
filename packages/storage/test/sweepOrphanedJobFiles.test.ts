import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import {
  LocalStorageAdapter,
  ORPHANED_JOB_FILE_GRACE_HOURS,
  sweepOrphanedJobFiles,
  type StorageAdapter,
} from "../src/index.js";

const NOW_MS = Date.parse("2026-10-14T12:00:00.000Z");
const hoursAgo = (hours: number) => NOW_MS - hours * 60 * 60 * 1000;

/**
 * Just enough of `adminJob` for the two lookups the sweep makes. `named` is what the jobs name when the sweep
 * starts, `namedLater` what a job is given after that (the second lookup, right before a delete, sees both).
 */
function fakeDb(named: readonly string[], namedLater: readonly string[] = []): PrismaClient {
  return {
    adminJob: {
      findMany: vi.fn(async () => [...named.map((storage_key) => ({ storage_key })), { storage_key: null }]),
      findFirst: vi.fn(async ({ where }: { where: { storage_key: string } }) =>
        [...named, ...namedLater].includes(where.storage_key) ? { id: "job-1" } : null,
      ),
    },
  } as unknown as PrismaClient;
}

describe("sweepOrphanedJobFiles", () => {
  let uploadDir: string;
  let storage: LocalStorageAdapter;

  beforeEach(() => {
    uploadDir = mkdtempSync(join(tmpdir(), "admitto-orphan-sweep-"));
    storage = new LocalStorageAdapter({ UPLOAD_DIR: uploadDir });
  });

  afterEach(() => {
    rmSync(uploadDir, { recursive: true, force: true });
  });

  /** A job file as the export worker or the import enqueue writes it, `ageHours` old at NOW_MS. */
  async function jobFile(ageHours: number, ext = ".csv", eventId = "evt-1"): Promise<string> {
    const { key } = await storage.put(Buffer.from("name,email\nAda Example,ada@example.com\n"), {
      orgId: "org-1",
      eventId,
      scope: "event",
      ext,
    });
    const seconds = hoursAgo(ageHours) / 1000;
    utimesSync(join(uploadDir, key), seconds, seconds);
    return key;
  }

  /** A file at an arbitrary path under the upload root, `ageHours` old at NOW_MS. */
  function plainFile(relativePath: string, ageHours: number): string {
    const abs = join(uploadDir, relativePath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "x");
    const seconds = hoursAgo(ageHours) / 1000;
    utimesSync(abs, seconds, seconds);
    return relativePath;
  }

  const onDisk = (key: string) => existsSync(join(uploadDir, key));
  const sweep = (db: PrismaClient, options: { dryRun?: boolean; graceHours?: number; storage?: StorageAdapter } = {}) =>
    sweepOrphanedJobFiles(db, options.storage ?? storage, {
      dryRun: options.dryRun ?? false,
      nowMs: NOW_MS,
      ...(options.graceHours === undefined ? {} : { graceHours: options.graceHours }),
    });

  it("deletes a file that no job names, and keeps every file that a job names, however old or new it is", async () => {
    const orphan = await jobFile(30, ".xlsx");
    const namedByFailedJob = await jobFile(24 * 40, ".csv");
    const namedByExport = await jobFile(30, ".pdf");
    const namedJustNow = await jobFile(0.1, ".csv");
    const db = fakeDb([namedByFailedJob, namedByExport, namedJustNow]);

    const result = await sweep(db);

    expect(result).toEqual({ scanned: 4, named: 3, tooNew: 0, deleted: 1, failed: 0 });
    expect(onDisk(orphan)).toBe(false);
    expect([namedByFailedJob, namedByExport, namedJustNow].every(onDisk)).toBe(true);
    // The first read of the keys settles the files that jobs name: only the one that looks unnamed is looked up again.
    expect(db.adminJob.findFirst).toHaveBeenCalledTimes(1);
  });

  it("leaves a file that no job names yet while it is younger than a day, and takes it from the day on", async () => {
    const justUnder = await jobFile(ORPHANED_JOB_FILE_GRACE_HOURS - 0.01);
    const exactly = await jobFile(ORPHANED_JOB_FILE_GRACE_HOURS);
    const fresh = await jobFile(0);

    const result = await sweep(fakeDb([]));

    expect(result).toEqual({ scanned: 3, named: 0, tooNew: 2, deleted: 1, failed: 0 });
    expect(onDisk(justUnder)).toBe(true);
    expect(onDisk(fresh)).toBe(true);
    expect(onDisk(exactly)).toBe(false);
  });

  it("only counts with a dry run, and deletes nothing", async () => {
    const orphan = await jobFile(48);
    const db = fakeDb([]);

    const result = await sweep(db, { dryRun: true });

    expect(result).toEqual({ scanned: 1, named: 0, tooNew: 0, deleted: 1, failed: 0 });
    expect(onDisk(orphan)).toBe(true);
  });

  it("looks the key up again right before the delete: a job that was given it meanwhile keeps its file", async () => {
    const racing = await jobFile(48);
    const orphan = await jobFile(48);

    const result = await sweep(fakeDb([], [racing]));

    expect(result).toEqual({ scanned: 2, named: 1, tooNew: 0, deleted: 1, failed: 0 });
    expect(onDisk(racing)).toBe(true);
    expect(onDisk(orphan)).toBe(false);
  });

  it("counts a file that cannot be deleted, goes on with the rest and leaves it for the next run", async () => {
    const stuck = await jobFile(48);
    const other = await jobFile(48);
    const failing: StorageAdapter = Object.create(storage, {
      delete: {
        value: async (key: string) => {
          if (key === stuck) throw new Error("EBUSY");
          return storage.delete(key);
        },
      },
    });

    const result = await sweep(fakeDb([]), { storage: failing });

    expect(result).toEqual({ scanned: 2, named: 0, tooNew: 0, deleted: 1, failed: 1 });
    expect(onDisk(stuck)).toBe(true);
    expect(onDisk(other)).toBe(false);
  });

  it("does not count a file that somebody else deleted in the meantime", async () => {
    const vanishing = await jobFile(48);
    const racing: StorageAdapter = Object.create(storage, {
      delete: {
        value: async (key: string) => {
          await storage.delete(key);
          return { deleted: false };
        },
      },
    });

    const result = await sweep(fakeDb([]), { storage: racing });

    expect(result).toEqual({ scanned: 1, named: 0, tooNew: 0, deleted: 0, failed: 0 });
    expect(onDisk(vanishing)).toBe(false);
  });

  it("does not look at anything that is not a job file: branding uploads and files outside the job layout stay", async () => {
    const orphan = await jobFile(48);
    const image = plainFile("org-1/events/evt-1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png", 48);
    const notes = plainFile("org-1/events/evt-1/readme.txt", 48);
    const notAUuid = plainFile("org-1/events/evt-1/report.csv", 48);
    const orgLevel = plainFile("org-1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.csv", 48);
    const theme = plainFile("org-1/theme/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf", 48);
    const deeper = plainFile("org-1/events/evt-1/old/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.xlsx", 48);

    const result = await sweep(fakeDb([]));

    expect(result).toEqual({ scanned: 1, named: 0, tooNew: 0, deleted: 1, failed: 0 });
    expect(onDisk(orphan)).toBe(false);
    for (const kept of [image, notes, notAUuid, orgLevel, theme, deeper]) expect(onDisk(kept)).toBe(true);
  });

  it("finds orphans of every event and every extension a job writes", async () => {
    const keys = [
      await jobFile(48, ".csv", "evt-1"),
      await jobFile(48, ".xlsx", "evt-2"),
      await jobFile(48, ".pdf", "evt-3"),
    ];

    const result = await sweep(fakeDb([]));

    expect(result.deleted).toBe(3);
    expect(keys.some(onDisk)).toBe(false);
  });

  it("does nothing when there is no upload directory yet", async () => {
    rmSync(uploadDir, { recursive: true, force: true });

    expect(await sweep(fakeDb([]))).toEqual({ scanned: 0, named: 0, tooNew: 0, deleted: 0, failed: 0 });
  });

  it("takes the window from graceHours, and falls back to a day for a value that is not a number of hours", async () => {
    const twoHoursOld = await jobFile(2);
    const twoDaysOld = await jobFile(48);

    for (const graceHours of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect((await sweep(fakeDb([]), { dryRun: true, graceHours })).deleted, String(graceHours)).toBe(1);
    }
    expect((await sweep(fakeDb([]), { dryRun: true, graceHours: 1 })).deleted).toBe(2);
    expect((await sweep(fakeDb([]), { dryRun: true, graceHours: 0 })).deleted).toBe(2);
    expect((await sweep(fakeDb([]), { dryRun: true, graceHours: 72 })).deleted).toBe(0);
    expect([twoHoursOld, twoDaysOld].every(onDisk)).toBe(true);
  });

  it("counts the age from the current time when no clock is given", async () => {
    const old = await jobFile(0);
    const aDayAndAnHourAgo = (Date.now() - 25 * 60 * 60 * 1000) / 1000;
    utimesSync(join(uploadDir, old), aDayAndAnHourAgo, aDayAndAnHourAgo);
    const fresh = await jobFile(0);
    const justNow = Date.now() / 1000;
    utimesSync(join(uploadDir, fresh), justNow, justNow);

    const result = await sweepOrphanedJobFiles(fakeDb([]), storage, { dryRun: false });

    expect(result).toMatchObject({ scanned: 2, tooNew: 1, deleted: 1 });
    expect(onDisk(old)).toBe(false);
    expect(onDisk(fresh)).toBe(true);
  });

  it("deletes nothing when the database cannot be read, at the start or right before a delete", async () => {
    const orphan = await jobFile(48);
    const unreadableAtStart = { adminJob: { findMany: vi.fn().mockRejectedValue(new Error("database is down")) } } as unknown as PrismaClient;
    const unreadableBeforeDelete = {
      adminJob: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockRejectedValue(new Error("database is down")),
      },
    } as unknown as PrismaClient;

    await expect(sweep(unreadableAtStart)).rejects.toThrow("database is down");
    await expect(sweep(unreadableBeforeDelete)).rejects.toThrow("database is down");

    expect(onDisk(orphan)).toBe(true);
  });

  it("lets a failure of the listing through, so that the caller can tell the sweep broke", async () => {
    const broken: StorageAdapter = Object.create(storage, {
      listJobFiles: {
        value: async function* () {
          yield* [];
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        },
      },
    });

    await expect(sweep(fakeDb([]), { storage: broken })).rejects.toMatchObject({ code: "EACCES" });
  });
});
