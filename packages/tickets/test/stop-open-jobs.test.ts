/**
 * stopOpenAttendeeJobs: an erasure or a removal closes the exports and the imports of the event that have not
 * finished (waiting or running), in its own transaction, so that a file they are still building cannot be recorded
 * afterwards, a waiting job cannot be claimed and read while the erasure is still open, and an import cannot create
 * a person again. lockAttendeeJobQueue: a job that is being created waits for an open erasure, and the other way
 * round.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@admitto/db";
import type { Prisma } from "@admitto/db/client";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { eraseAttendees } from "../src/erase-attendees.js";
import { removeAttendees } from "../src/remove-attendees.js";
import {
  EXPORT_STOPPED_BY_ERASURE_ERROR,
  IMPORT_STOPPED_BY_ERASURE_ERROR,
  lockAttendeeJobQueue,
  stopOpenAttendeeJobs,
} from "../src/stop-open-jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");
const ORG_ID = "org_stop_exports";
const EVENT_ID = "evt-stop-exports";
const OTHER_EVENT_ID = "evt-stop-exports-other";

let prisma: PrismaClient;
let seq = 0;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = createTestPrismaClient();
  await prisma.organization.create({ data: { id: ORG_ID, name: "Stop exports", slug: "stop-exports-org" } });
  for (const id of [EVENT_ID, OTHER_EVENT_ID]) {
    await prisma.event.create({
      data: { id, title: id, slug: id, organization_id: ORG_ID, date: new Date("2026-09-01T09:00:00Z") },
    });
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(async () => {
  await prisma.adminJob.deleteMany({ where: { event_id: { in: [EVENT_ID, OTHER_EVENT_ID] } } });
});

const jobData = (eventId: string, type: string, status: string): Prisma.AdminJobUncheckedCreateInput => ({
  type,
  status,
  organization_id: ORG_ID,
  event_id: eventId,
  ...(type === "export"
    ? { result_json: { request: { kind: "attendees_filtered", format: "csv", filters: { q: "Ada Lovelace" } } } }
    : {}),
});
const job = (eventId: string, type: string, status: string) =>
  prisma.adminJob.create({ data: jobData(eventId, type, status) });
const statusOf = async (id: string) => (await prisma.adminJob.findUniqueOrThrow({ where: { id } })).status;
const stop = () => prisma.$transaction((tx) => stopOpenAttendeeJobs(tx, EVENT_ID));

/** Waits until a statement whose text contains `text` waits for a lock that another transaction holds. */
const waitUntilWaitingFor = (text: string) =>
  vi.waitFor(
    async () => {
      const rows = await prisma.$queryRaw<{ waiting: bigint }[]>`
        SELECT count(*)::bigint AS "waiting" FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${`%${text}%`}
      `;
      expect(Number(rows[0]?.waiting ?? 0)).toBeGreaterThan(0);
    },
    { timeout: 5000, interval: 25 },
  );

/** A transaction that runs `work` and stays open until `commit` is called. */
function holdTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: (value: T) => void;
  const hasStarted = new Promise<T>((resolve) => {
    started = resolve;
  });
  const transaction = prisma.$transaction(
    async (tx) => {
      started(await work(tx));
      await released;
    },
    { timeout: 30_000 },
  );
  return {
    started: hasStarted,
    commit: async () => {
      release();
      await transaction;
    },
  };
}

describe("stopOpenAttendeeJobs", () => {
  it.each([
    ["export", "pending", EXPORT_STOPPED_BY_ERASURE_ERROR],
    ["export", "running", EXPORT_STOPPED_BY_ERASURE_ERROR],
    ["import_commit", "pending", IMPORT_STOPPED_BY_ERASURE_ERROR],
    ["import_commit", "running", IMPORT_STOPPED_BY_ERASURE_ERROR],
  ])("closes an %s of the event that is %s, with its reason", async (type, status, reason) => {
    const open = await job(EVENT_ID, type, status);

    expect(await stop()).toBe(1);

    const closed = await prisma.adminJob.findUniqueOrThrow({ where: { id: open.id } });
    expect(closed).toMatchObject({ status: "failed", error: reason });
    expect(closed.finished_at).not.toBeNull();
  });

  it("scrubs the search text of an export it closes", async () => {
    const open = await job(EVENT_ID, "export", "pending");

    await stop();

    const closed = await prisma.adminJob.findUniqueOrThrow({ where: { id: open.id } });
    expect(JSON.stringify(closed.result_json)).not.toContain("Lovelace");
  });

  it("leaves alone a finished job, another event's, and a job of another type", async () => {
    const finished = [
      await job(EVENT_ID, "export", "succeeded"),
      await job(EVENT_ID, "export", "failed"),
      await job(EVENT_ID, "import_commit", "succeeded"),
      await job(EVENT_ID, "import_commit", "failed"),
    ];
    const open = [
      await job(OTHER_EVENT_ID, "export", "running"),
      await job(OTHER_EVENT_ID, "export", "pending"),
      await job(OTHER_EVENT_ID, "import_commit", "running"),
      await job(OTHER_EVENT_ID, "import_commit", "pending"),
      await job(EVENT_ID, "wallet_push", "running"),
      await job(EVENT_ID, "wallet_push", "pending"),
    ];

    expect(await stop()).toBe(0);

    for (const j of finished) expect(["succeeded", "failed"]).toContain(await statusOf(j.id));
    expect(await Promise.all(open.map((j) => statusOf(j.id)))).toEqual([
      "running",
      "pending",
      "running",
      "pending",
      "running",
      "pending",
    ]);
  });

  it.each([
    ["export", "running", "succeeded"],
    ["import_commit", "running", "succeeded"],
    ["export", "pending", "running"],
    ["import_commit", "pending", "running"],
  ])(
    "makes the worker wait for the erasure when it moves an %s from %s to %s, and then finds the job closed",
    async (type, from, to) => {
      const open = await job(EVENT_ID, type, from);
      const erasing = holdTransaction((tx) => stopOpenAttendeeJobs(tx, EVENT_ID));
      await erasing.started;

      // What the worker does to claim a job, or to record what it did: one conditional update of the row. A Prisma
      // query only starts when something waits for it, so `.then` starts it now.
      const moving = prisma.adminJob.updateMany({ where: { id: open.id, status: from }, data: { status: to } }).then((result) => result);
      await waitUntilWaitingFor("UPDATE%AdminJob");
      await erasing.commit();

      expect((await moving).count).toBe(0);
      expect(await statusOf(open.id)).toBe("failed");
    },
  );

  it("is what an erasure and a removal do: they stop the open jobs, and a call that changes nobody does not", async () => {
    const attendee = await prisma.attendee.create({
      data: { id: `stop-exports-att-${++seq}`, event_id: EVENT_ID, email: `stop${seq}@example.com`, name: `Person ${seq}` },
    });
    const other = await prisma.attendee.create({
      data: { id: `stop-exports-att-${++seq}`, event_id: EVENT_ID, email: `stop${seq}@example.com`, name: `Person ${seq}` },
    });
    const firstExport = await job(EVENT_ID, "export", "running");
    const firstImport = await job(EVENT_ID, "import_commit", "pending");
    await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: ["nobody"] }));
    expect(await statusOf(firstExport.id)).toBe("running");
    expect(await statusOf(firstImport.id)).toBe("pending");

    await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: [attendee.id] }));
    expect(await statusOf(firstExport.id)).toBe("failed");
    expect(await statusOf(firstImport.id)).toBe("failed");

    const secondExport = await job(EVENT_ID, "export", "running");
    const secondImport = await job(EVENT_ID, "import_commit", "running");
    await prisma.$transaction((tx) => removeAttendees(tx, { eventId: EVENT_ID, attendeeIds: ["nobody"] }));
    expect(await statusOf(secondExport.id)).toBe("running");
    expect(await statusOf(secondImport.id)).toBe("running");

    await prisma.$transaction((tx) => removeAttendees(tx, { eventId: EVENT_ID, attendeeIds: [other.id] }));
    expect(await statusOf(secondExport.id)).toBe("failed");
    expect(await statusOf(secondImport.id)).toBe("failed");
  });
});

describe("an erasure or a removal", () => {
  const attendeeIn = (eventId: string) =>
    prisma.attendee.create({
      data: { id: `stop-exports-att-${++seq}`, event_id: eventId, email: `queue${seq}@example.com`, name: `Person ${seq}` },
    });

  /** True when nothing holds the row: a probe that fails at once instead of waiting if somebody does. */
  const rowIsFree = async (id: string) => {
    try {
      await prisma.$queryRaw`SELECT "id" FROM "Attendee" WHERE "id" = ${id} FOR UPDATE NOWAIT`;
      return true;
    } catch {
      return false;
    }
  };

  const erase = (tx: Prisma.TransactionClient, eventId: string, id: string) => eraseAttendees(tx, { eventId, attendeeIds: [id] });
  const remove = (tx: Prisma.TransactionClient, eventId: string, id: string) => removeAttendees(tx, { eventId, attendeeIds: [id] });
  const isErased = async (id: string) => ((await prisma.attendee.findUnique({ where: { id } }))?.erased_at ?? null) !== null;
  const isGone = async (id: string) => (await prisma.attendee.findUnique({ where: { id } })) === null;

  it.each([
    ["erasure", erase, isErased],
    ["removal", remove, isGone],
  ])(
    "waits for another %s of the event before it locks a single row, so that the two cannot deadlock",
    async (_name, act, done) => {
      const first = await attendeeIn(EVENT_ID);
      const second = await attendeeIn(EVENT_ID);
      const open = holdTransaction((tx) => act(tx, EVENT_ID, first.id));
      await open.started;

      const waiting = prisma.$transaction((tx) => act(tx, EVENT_ID, second.id));
      await waitUntilWaitingFor("pg_advisory_xact_lock(");
      // It has not locked the row of its own attendee: it waits at its first statement.
      expect(await rowIsFree(second.id)).toBe(true);
      await open.commit();
      await waiting;

      expect(await done(first.id)).toBe(true);
      expect(await done(second.id)).toBe(true);
    },
  );

  it("waits for an import whose transaction holds its job before it locks a single attendee, then stops the job", async () => {
    const person = await attendeeIn(EVENT_ID);
    const running = await job(EVENT_ID, "import_commit", "running");
    // What the import does first: it takes the row of its job and keeps it until it has committed.
    const importing = holdTransaction((tx) => tx.$queryRaw`SELECT "status" FROM "AdminJob" WHERE "id" = ${running.id} FOR UPDATE`);
    await importing.started;

    const erasing = prisma.$transaction((tx) => erase(tx, EVENT_ID, person.id));
    await waitUntilWaitingFor("SELECT%AdminJob%FOR UPDATE");
    expect(await rowIsFree(person.id)).toBe(true);
    await importing.commit();
    await erasing;

    expect(await isErased(person.id)).toBe(true);
    expect(await statusOf(running.id)).toBe("failed");
  });

  it.each([
    ["erasure", erase],
    ["removal", remove],
  ])(
    "hands back the jobs that held a file when the %s ended, the stopped ones included, and not a job created afterwards",
    async (_name, act) => {
      const person = await attendeeIn(EVENT_ID);
      const withKey = (type: string, status: string, eventId: string, key: string) =>
        prisma.adminJob.create({ data: { ...jobData(eventId, type, status), storage_key: key } });
      const finishedExport = await withKey("export", "succeeded", EVENT_ID, "k/one.csv");
      const waitingImport = await withKey("import_commit", "pending", EVENT_ID, "k/two.csv");
      await job(EVENT_ID, "export", "failed"); // no file
      await withKey("wallet_push", "succeeded", EVENT_ID, "k/three.csv"); // not a job that holds attendees
      await withKey("export", "succeeded", OTHER_EVENT_ID, "k/four.csv"); // another event

      const result = await prisma.$transaction((tx) => act(tx, EVENT_ID, person.id));
      // An export requested right after the erasure, finished before anything purges: the erasure never saw it.
      const later = await withKey("export", "succeeded", EVENT_ID, "k/five.csv");

      expect(result.jobIdsWithFiles).toEqual([finishedExport.id, waitingImport.id].sort());
      expect(result.jobIdsWithFiles).not.toContain(later.id);
    },
  );

  it("does not wait for an erasure of another event", async () => {
    const mine = await attendeeIn(EVENT_ID);
    const theirs = await attendeeIn(OTHER_EVENT_ID);
    const open = holdTransaction((tx) => erase(tx, OTHER_EVENT_ID, theirs.id));
    await open.started;

    await prisma.$transaction((tx) => erase(tx, EVENT_ID, mine.id));

    await open.commit();
    expect(await isErased(mine.id)).toBe(true);
    expect(await isErased(theirs.id)).toBe(true);
  });
});

describe("lockAttendeeJobQueue", () => {
  it.each(["export", "import_commit"])(
    "makes the erasure wait for an %s job that is being created, and then see it",
    async (type) => {
      const creating = holdTransaction(async (tx) => {
        await lockAttendeeJobQueue(tx, EVENT_ID, "shared");
        return tx.adminJob.create({ data: jobData(EVENT_ID, type, "pending") });
      });
      const created = await creating.started;

      const stopping = stop();
      await waitUntilWaitingFor("pg_advisory_xact_lock(");
      await creating.commit();

      expect(await stopping).toBe(1);
      expect(await statusOf(created.id)).toBe("failed");
    },
  );

  it.each(["export", "import_commit"])(
    "makes an %s job that is being created wait for an open erasure, and start after it",
    async (type) => {
      const erasure = holdTransaction((tx) => stopOpenAttendeeJobs(tx, EVENT_ID));
      await erasure.started;

      const creating = prisma.$transaction(async (tx) => {
        await lockAttendeeJobQueue(tx, EVENT_ID, "shared");
        return tx.adminJob.create({ data: jobData(EVENT_ID, type, "pending") });
      });
      await waitUntilWaitingFor("pg_advisory_xact_lock_shared");
      expect(await prisma.adminJob.count({ where: { event_id: EVENT_ID } })).toBe(0);
      await erasure.commit();

      const created = await creating;
      expect(await statusOf(created.id)).toBe("pending");
    },
  );

  it("does not make jobs being created wait for each other", async () => {
    const first = holdTransaction((tx) => lockAttendeeJobQueue(tx, EVENT_ID, "shared"));
    await first.started;

    const second = await prisma.$transaction(async (tx) => {
      await lockAttendeeJobQueue(tx, EVENT_ID, "shared");
      return tx.adminJob.create({ data: jobData(EVENT_ID, "export", "pending") });
    });

    await first.commit();
    expect(await statusOf(second.id)).toBe("pending");
  });

  it("does not block the queue of another event", async () => {
    const erasure = holdTransaction((tx) => stopOpenAttendeeJobs(tx, EVENT_ID));
    await erasure.started;

    const other = await prisma.$transaction(async (tx) => {
      await lockAttendeeJobQueue(tx, OTHER_EVENT_ID, "shared");
      return tx.adminJob.create({ data: jobData(OTHER_EVENT_ID, "export", "pending") });
    });

    await erasure.commit();
    expect(await statusOf(other.id)).toBe("pending");
  });
});
