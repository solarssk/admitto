/**
 * stopOpenExportJobs: an erasure or a removal closes the exports of the event that have not finished (waiting or
 * running), in its own transaction, so that a file they are still building cannot be recorded afterwards and a
 * waiting one cannot be claimed and read while the erasure is still open.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@admitto/db";
import type { Prisma } from "@admitto/db/client";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { eraseAttendees } from "../src/erase-attendees.js";
import { removeAttendees } from "../src/remove-attendees.js";
import { EXPORT_STOPPED_BY_ERASURE_ERROR, stopOpenExportJobs } from "../src/stop-open-exports.js";

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

const job = (eventId: string, type: string, status: string) =>
  prisma.adminJob.create({
    data: {
      type,
      status,
      organization_id: ORG_ID,
      event_id: eventId,
      result_json: { request: { kind: "attendees_filtered", format: "csv", filters: { q: "Ada Lovelace" } } },
    },
  });
const statusOf = async (id: string) => (await prisma.adminJob.findUniqueOrThrow({ where: { id } })).status;
const stop = () => prisma.$transaction((tx) => stopOpenExportJobs(tx, EVENT_ID));

describe("stopOpenExportJobs", () => {
  it.each(["pending", "running"])(
    "closes an export of the event that is %s, with the reason, and scrubs its search text",
    async (status) => {
      const open = await job(EVENT_ID, "export", status);

      expect(await stop()).toBe(1);

      const closed = await prisma.adminJob.findUniqueOrThrow({ where: { id: open.id } });
      expect(closed).toMatchObject({ status: "failed", error: EXPORT_STOPPED_BY_ERASURE_ERROR });
      expect(closed.finished_at).not.toBeNull();
      expect(JSON.stringify(closed.result_json)).not.toContain("Lovelace");
    },
  );

  it("leaves alone a finished export, another event's, and a job of another type", async () => {
    const succeeded = await job(EVENT_ID, "export", "succeeded");
    const failed = await job(EVENT_ID, "export", "failed");
    const otherEvent = await job(OTHER_EVENT_ID, "export", "running");
    const otherEventWaiting = await job(OTHER_EVENT_ID, "export", "pending");
    const importRunning = await job(EVENT_ID, "import_commit", "running");
    const importWaiting = await job(EVENT_ID, "import_commit", "pending");

    expect(await stop()).toBe(0);

    expect(await statusOf(succeeded.id)).toBe("succeeded");
    expect(await statusOf(failed.id)).toBe("failed");
    expect(await statusOf(otherEvent.id)).toBe("running");
    expect(await statusOf(otherEventWaiting.id)).toBe("pending");
    expect(await statusOf(importRunning.id)).toBe("running");
    expect(await statusOf(importWaiting.id)).toBe("pending");
  });

  /**
   * A transaction whose first search is followed by `between`, run on another connection and committed before
   * the update: the worker changing the job after the erasure looked and before it wrote.
   */
  const stopWithWorkerBetween = (between: () => Promise<unknown>) =>
    prisma.$transaction((tx) => {
      const racing = {
        adminJob: {
          findMany: async (args: Prisma.AdminJobFindManyArgs) => {
            const rows = await tx.adminJob.findMany(args);
            await between();
            return rows;
          },
          updateMany: (args: Prisma.AdminJobUpdateManyArgs) => tx.adminJob.updateMany(args),
        },
      } as unknown as Prisma.TransactionClient;
      return stopOpenExportJobs(racing, EVENT_ID);
    });

  it("leaves a job alone that finished between the search and the update, with the file it recorded", async () => {
    const racing = await job(EVENT_ID, "export", "running");

    const stopped = await stopWithWorkerBetween(() =>
      prisma.adminJob.update({
        where: { id: racing.id },
        data: { status: "succeeded", storage_key: "events/e/file.csv", finished_at: new Date() },
      }),
    );

    expect(stopped).toBe(0);
    expect(await prisma.adminJob.findUniqueOrThrow({ where: { id: racing.id } })).toMatchObject({
      status: "succeeded",
      storage_key: "events/e/file.csv",
      error: null,
    });
  });

  it("closes a job that the worker claimed between the search and the update", async () => {
    const racing = await job(EVENT_ID, "export", "pending");

    const stopped = await stopWithWorkerBetween(() =>
      prisma.adminJob.update({ where: { id: racing.id }, data: { status: "running", started_at: new Date() } }),
    );

    expect(stopped).toBe(1);
    expect(await prisma.adminJob.findUniqueOrThrow({ where: { id: racing.id } })).toMatchObject({
      status: "failed",
      error: EXPORT_STOPPED_BY_ERASURE_ERROR,
    });
  });

  it("is what an erasure and a removal do: they stop the open export, and a call that changes nobody does not", async () => {
    const attendee = await prisma.attendee.create({
      data: { id: `stop-exports-att-${++seq}`, event_id: EVENT_ID, email: `stop${seq}@example.com`, name: `Person ${seq}` },
    });
    const other = await prisma.attendee.create({
      data: { id: `stop-exports-att-${++seq}`, event_id: EVENT_ID, email: `stop${seq}@example.com`, name: `Person ${seq}` },
    });
    const first = await job(EVENT_ID, "export", "running");
    await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: ["nobody"] }));
    expect(await statusOf(first.id)).toBe("running");

    await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: [attendee.id] }));
    expect(await statusOf(first.id)).toBe("failed");

    const second = await job(EVENT_ID, "export", "running");
    await prisma.$transaction((tx) => removeAttendees(tx, { eventId: EVENT_ID, attendeeIds: ["nobody"] }));
    expect(await statusOf(second.id)).toBe("running");

    await prisma.$transaction((tx) => removeAttendees(tx, { eventId: EVENT_ID, attendeeIds: [other.id] }));
    expect(await statusOf(second.id)).toBe("failed");
  });
});
