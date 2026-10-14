/**
 * The sweep of files that no job names (sweepOrphanedJobFiles), against the database: which files it keeps and which
 * it takes, and the one way a file used to be left for good, a process killed between writing an export file and
 * recording its key on the job. The import enqueue has the same case in admin-import.test.ts.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { drainImportJobs } from "@admitto/import";
import {
  LocalStorageAdapter,
  ORPHANED_JOB_FILE_GRACE_HOURS,
  purgeEventJobFiles,
  purgeJobFiles,
  sweepOrphanedJobFiles,
} from "@admitto/storage";
import { drainExportJobs, eraseAttendees, reclaimStaleExportJobs, type ExportJobStorage } from "@admitto/tickets";

const ORG_ID = "org-orphaned-job-files";
const EVENT_ID = "evt-orphaned-job-files";
const ATTENDEE_ID = "att-orphaned-job-files";
const HOUR_MS = 60 * 60 * 1000;

let prisma: PrismaClient;
let storage: LocalStorageAdapter;
let uploadDir = "";

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await prisma.adminJob.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.organization.create({ data: { id: ORG_ID, name: "Orphaned Job Files Org", slug: "orphaned-job-files" } });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Orphaned Job Files Event",
      slug: "orphaned-job-files-event",
      organization_id: ORG_ID,
      date: new Date("2026-11-01T09:00:00Z"),
    },
  });
  uploadDir = await mkdtemp(join(tmpdir(), "admitto-orphaned-job-files-"));
  storage = new LocalStorageAdapter({ UPLOAD_DIR: uploadDir });
});

/**
 * The worker claims the oldest job that is waiting and the retention purge looks at every finished one, whichever
 * test file of the run left them in this schema: start from none, so that what they find is what the test made.
 */
const clearExportAndImportJobs = () =>
  prisma.adminJob.deleteMany({ where: { type: { in: ["export", "import_commit"] } } });

beforeEach(async () => {
  await clearExportAndImportJobs();
  await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.attendee.create({
    data: { id: ATTENDEE_ID, event_id: EVENT_ID, email: "ada.orphan@example.com", name: "Ada Orphan" },
  });
  await rm(uploadDir, { recursive: true, force: true });
  await mkdir(uploadDir, { recursive: true });
});

afterAll(async () => {
  await clearExportAndImportJobs();
  await prisma?.$disconnect();
  if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
});

/** A job file as the export worker or the import enqueue writes it. */
async function storedFile(ext = ".csv", orgId = ORG_ID, eventId = EVENT_ID): Promise<string> {
  const { key } = await storage.put(Buffer.from("name,email\nAda Example,ada@example.com\n"), {
    orgId,
    eventId,
    scope: "event",
    ext,
  });
  return key;
}

const jobNaming = (type: string, status: string, storage_key: string) =>
  prisma.adminJob.create({ data: { type, status, organization_id: ORG_ID, event_id: EVENT_ID, storage_key } });

/** An export that waits for the worker, asking for the whole attendee list as a CSV. */
const pendingExport = () =>
  prisma.adminJob.create({
    data: {
      type: "export",
      status: "pending",
      organization_id: ORG_ID,
      event_id: EVENT_ID,
      result_json: { request: { kind: "attendees_filtered", format: "csv", filters: {} } },
    },
  });

const onDisk = (key: string) => existsSync(join(uploadDir, key));

type Hooks = { afterFirstRead?: () => Promise<void>; onLookup?: (key: string) => void };

/** The database as the sweep sees it: the real queries, with a hook after its first read and one on each lookup of a key. */
function observedDb(hooks: Hooks): PrismaClient {
  return {
    adminJob: {
      findMany: async (args: Parameters<PrismaClient["adminJob"]["findMany"]>[0]) => {
        const rows = await prisma.adminJob.findMany(args);
        await hooks.afterFirstRead?.();
        return rows;
      },
      findFirst: (args: Parameters<PrismaClient["adminJob"]["findFirst"]>[0]) => {
        hooks.onLookup?.(String(args?.where?.storage_key));
        return prisma.adminJob.findFirst(args);
      },
    },
  } as unknown as PrismaClient;
}

/** The sweep, run `hoursLater` after the files were written. */
const sweepAfter = (hoursLater: number, db: PrismaClient = prisma, dryRun = false) =>
  sweepOrphanedJobFiles(db, storage, { dryRun, nowMs: Date.now() + hoursLater * HOUR_MS });

describe("sweepOrphanedJobFiles, against the database", () => {
  it("takes the files that no job names and keeps every file that a job of any status or type names", async () => {
    const exportDone = await storedFile(".xlsx");
    const exportFailed = await storedFile(".pdf");
    const importWaiting = await storedFile();
    const importFailed = await storedFile();
    await jobNaming("export", "succeeded", exportDone);
    await jobNaming("export", "failed", exportFailed);
    await jobNaming("import_commit", "pending", importWaiting);
    await jobNaming("import_commit", "failed", importFailed);
    // A key whose file is already gone, and a job that has no file at all, change nothing.
    await jobNaming("export", "succeeded", `${ORG_ID}/events/${EVENT_ID}/${randomUUID()}.csv`);
    await prisma.adminJob.create({ data: { type: "export", status: "running", organization_id: ORG_ID, event_id: EVENT_ID } });
    const orphan = await storedFile();
    const orphanOfAnotherEvent = await storedFile(".csv", "org-somewhere-else", "evt-somewhere-else");

    const lookedUp: string[] = [];

    const result = await sweepAfter(ORPHANED_JOB_FILE_GRACE_HOURS + 1, observedDb({ onLookup: (key) => lookedUp.push(key) }));

    expect(result).toEqual({ scanned: 6, named: 4, tooNew: 0, deleted: 2, failed: 0 });
    expect([orphan, orphanOfAnotherEvent].some(onDisk)).toBe(false);
    expect([exportDone, exportFailed, importWaiting, importFailed].every(onDisk)).toBe(true);
    // What the jobs name, of any status and type, is read in one go: only the two files that look unnamed are looked up again.
    expect(lookedUp.sort()).toEqual([orphan, orphanOfAnotherEvent].sort());
  });

  it("leaves a file that no job names yet until it is a day old", async () => {
    const written = await storedFile();

    expect(await sweepAfter(ORPHANED_JOB_FILE_GRACE_HOURS - 1)).toMatchObject({ scanned: 1, tooNew: 1, deleted: 0 });
    expect(onDisk(written)).toBe(true);

    expect(await sweepAfter(ORPHANED_JOB_FILE_GRACE_HOURS + 1)).toMatchObject({ scanned: 1, tooNew: 0, deleted: 1 });
    expect(onDisk(written)).toBe(false);
  });

  it("only counts with a dry run", async () => {
    const orphan = await storedFile();

    const result = await sweepAfter(ORPHANED_JOB_FILE_GRACE_HOURS + 1, prisma, true);

    expect(result).toMatchObject({ deleted: 1, failed: 0 });
    expect(onDisk(orphan)).toBe(true);
  });

  it("ends as a job whose file is gone when a job is given the key after the delete: the import fails with its fixed error and the purge clears the key", async () => {
    const key = await storedFile();
    await sweepAfter(ORPHANED_JOB_FILE_GRACE_HOURS + 1);
    expect(onDisk(key)).toBe(false);
    const late = await prisma.adminJob.create({
      data: {
        type: "import_commit",
        status: "pending",
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        storage_key: key,
        filename: "late.csv",
        import_id: randomUUID(),
      },
    });

    expect(await drainImportJobs(prisma, storage, { limit: 1 })).toMatchObject({ claimed: 1, failed: 1 });
    expect(await prisma.adminJob.findUniqueOrThrow({ where: { id: late.id } })).toMatchObject({
      status: "failed",
      error: "Import failed. Upload the file again.",
    });
    const retention = await purgeJobFiles(prisma, storage, { dryRun: false, now: new Date(Date.now() + 30 * 24 * HOUR_MS) });
    expect(retention).toEqual({ exportFiles: 0, stagedImportFiles: 1, failures: 0 });
    expect(await prisma.adminJob.findUniqueOrThrow({ where: { id: late.id } })).toMatchObject({ storage_key: null });
  });

  it("keeps a file that a job is given between the first read and the delete", async () => {
    const racing = await storedFile();
    const orphan = await storedFile();
    // The queries are the real ones; only the moment a job names `racing` is placed after the first read.
    const racingDb = observedDb({
      afterFirstRead: async () => {
        await jobNaming("export", "succeeded", racing);
      },
    });

    const result = await sweepAfter(ORPHANED_JOB_FILE_GRACE_HOURS + 1, racingDb);

    expect(result).toEqual({ scanned: 2, named: 1, tooNew: 0, deleted: 1, failed: 0 });
    expect(onDisk(racing)).toBe(true);
    expect(onDisk(orphan)).toBe(false);
  });
});

describe("an export worker that is killed after it stored the file and before it recorded the key", () => {
  /**
   * Stores the file for real, then stops for good: what the process does when it is killed between the write
   * and the update of the job. Nothing after the write runs, so the worker's own clean-up never gets its turn.
   */
  function killedAfterWrite(stored: (key: string) => void): ExportJobStorage {
    return {
      put: async (bytes, opts) => {
        const { key } = await storage.put(bytes, opts);
        stored(key);
        return new Promise<never>(() => undefined);
      },
      delete: (key) => storage.delete(key),
    };
  }

  it("leaves a file that the retention purge and the erasure cannot find, and that the sweep takes once it is a day old", async () => {
    const job = await pendingExport();
    let storedKey = "";
    let wasStored!: () => void;
    const written = new Promise<void>((resolve) => {
      wasStored = resolve;
    });
    const drained = drainExportJobs(
      prisma,
      killedAfterWrite((key) => {
        storedKey = key;
        wasStored();
      }),
      { limit: 1 },
    );
    // The worker never gets past the write. If it finishes, the stand-in did not stop it, and this says so.
    await Promise.race([
      written,
      drained.then(() => {
        throw new Error("the worker was not stopped after the write");
      }),
    ]);

    // The process is gone: the file holds the attendees, and the job does not name it.
    expect(onDisk(storedKey)).toBe(true);
    expect(await prisma.adminJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "running", storage_key: null });

    // The worker comes back and fails the job as stale. The person is erased, and the erasure purges the files of the jobs it saw.
    await reclaimStaleExportJobs(prisma, { olderThanMs: 60_000, now: new Date(Date.now() + HOUR_MS) });
    expect(await prisma.adminJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "failed", storage_key: null });
    const erased = await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: [ATTENDEE_ID] }));
    expect(erased.erasedIds).toEqual([ATTENDEE_ID]);
    expect(await purgeEventJobFiles(prisma, storage, EVENT_ID, erased.jobIdsWithFiles)).toEqual({ deleted: 0, failed: 0 });
    // Nor does a retention run that goes by the rows, however late it runs.
    const retention = await purgeJobFiles(prisma, storage, { dryRun: false, now: new Date(Date.now() + 365 * 24 * HOUR_MS) });
    expect(retention).toEqual({ exportFiles: 0, stagedImportFiles: 0, failures: 0 });
    expect(onDisk(storedKey)).toBe(true);

    // The sweep leaves it while a job could still be about to name it, and takes it after that.
    expect(await sweepAfter(ORPHANED_JOB_FILE_GRACE_HOURS - 1)).toMatchObject({ tooNew: 1, deleted: 0 });
    expect(onDisk(storedKey)).toBe(true);
    expect(await sweepAfter(ORPHANED_JOB_FILE_GRACE_HOURS + 1)).toMatchObject({ tooNew: 0, deleted: 1, failed: 0 });
    expect(onDisk(storedKey)).toBe(false);
  });

  it("also leaves such a file when the write reports a failure after the file was stored, and the sweep takes it", async () => {
    const job = await pendingExport();
    let storedKey = "";
    const failingAfterWrite: ExportJobStorage = {
      put: async (bytes, opts) => {
        storedKey = (await storage.put(bytes, opts)).key;
        throw new Error("connection reset");
      },
      delete: (key) => storage.delete(key),
    };

    expect(await drainExportJobs(prisma, failingAfterWrite, { limit: 1 })).toMatchObject({ claimed: 1, failed: 1 });

    // The job is failed and names nothing, and the bytes the store kept are in storage.
    expect(await prisma.adminJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "failed", storage_key: null });
    expect(onDisk(storedKey)).toBe(true);
    expect(await sweepAfter(ORPHANED_JOB_FILE_GRACE_HOURS + 1)).toMatchObject({ deleted: 1, failed: 0 });
    expect(onDisk(storedKey)).toBe(false);
  });
});
