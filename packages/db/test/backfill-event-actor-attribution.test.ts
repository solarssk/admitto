import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createTestPrismaClient } from "../src/testing.js";
import {
  backfillEventArchivedByUserId,
  backfillEventCreatedByUserId,
} from "../src/backfill-event-actor-attribution.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const ORG_ID = "org-backfill-event-actor";

let prisma: PrismaClient;
let eventSeq = 0;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = createTestPrismaClient();
  await prisma.organization.create({
    data: { id: ORG_ID, name: "Org", slug: "org-backfill-event-actor" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeEvent(overrides: { archived_at?: Date; created_by_user_id?: string; archived_by_user_id?: string }) {
  eventSeq += 1;
  const id = `evt-backfill-event-actor-${eventSeq}`;
  return prisma.event.create({
    data: {
      id,
      title: "Gala",
      slug: `gala-backfill-event-actor-${eventSeq}`,
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
      ...overrides,
    },
  });
}

async function makeAuditEntry(opts: {
  eventId: string;
  actionType: "event_created" | "event_archived";
  actorUserId: string;
  createdAt: Date;
  actorTimezone?: string;
}) {
  return prisma.adminAuditLog.create({
    data: {
      organization_id: ORG_ID,
      actor_user_id: opts.actorUserId,
      action_type: opts.actionType,
      metadata: { eventId: opts.eventId },
      created_at: opts.createdAt,
      actor_timezone: opts.actorTimezone,
    },
  });
}

describe("backfillEventCreatedByUserId", () => {
  it("recovers created_by_user_id and created_by_timezone from the matching event_created audit log entry", async () => {
    const event = await makeEvent({});
    await makeAuditEntry({
      eventId: event.id,
      actionType: "event_created",
      actorUserId: "user-creator-1",
      actorTimezone: "Europe/Warsaw",
      createdAt: new Date(),
    });

    const result = await backfillEventCreatedByUserId(prisma);
    expect(result.updated).toBeGreaterThanOrEqual(1);

    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.created_by_user_id).toBe("user-creator-1");
    expect(after.created_by_timezone).toBe("Europe/Warsaw");
  });

  it("leaves an event with no matching audit entry untouched", async () => {
    const event = await makeEvent({});

    await backfillEventCreatedByUserId(prisma);

    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.created_by_user_id).toBeNull();
  });

  it("does not overwrite an event that already has created_by_user_id set", async () => {
    const event = await makeEvent({ created_by_user_id: "user-original" });
    await makeAuditEntry({
      eventId: event.id,
      actionType: "event_created",
      actorUserId: "user-different",
      createdAt: new Date(),
    });

    await backfillEventCreatedByUserId(prisma);

    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.created_by_user_id).toBe("user-original");
  });

  it("is idempotent on a second run", async () => {
    const first = await backfillEventCreatedByUserId(prisma);
    expect(first.updated).toBe(0);
  });
});

describe("backfillEventArchivedByUserId", () => {
  it("recovers archived_by_user_id and archived_by_timezone from the matching event_archived audit log entry", async () => {
    const event = await makeEvent({ archived_at: new Date() });
    await makeAuditEntry({
      eventId: event.id,
      actionType: "event_archived",
      actorUserId: "user-archiver-1",
      actorTimezone: "Asia/Kolkata",
      createdAt: new Date(),
    });

    const result = await backfillEventArchivedByUserId(prisma);
    expect(result.updated).toBeGreaterThanOrEqual(1);

    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.archived_by_user_id).toBe("user-archiver-1");
    expect(after.archived_by_timezone).toBe("Asia/Kolkata");
  });

  it("picks the most recent event_archived entry across an archive/unarchive/re-archive cycle", async () => {
    const event = await makeEvent({ archived_at: new Date() });
    await makeAuditEntry({
      eventId: event.id,
      actionType: "event_archived",
      actorUserId: "user-first-archiver",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await makeAuditEntry({
      eventId: event.id,
      actionType: "event_archived",
      actorUserId: "user-second-archiver",
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
    });

    await backfillEventArchivedByUserId(prisma);

    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.archived_by_user_id).toBe("user-second-archiver");
  });

  it("leaves a currently-active event untouched even with a past event_archived entry", async () => {
    const event = await makeEvent({});
    await makeAuditEntry({
      eventId: event.id,
      actionType: "event_archived",
      actorUserId: "user-archiver-stale",
      createdAt: new Date(),
    });

    await backfillEventArchivedByUserId(prisma);

    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.archived_by_user_id).toBeNull();
  });

  it("does not overwrite an event that already has archived_by_user_id set", async () => {
    const event = await makeEvent({ archived_at: new Date(), archived_by_user_id: "user-original" });
    await makeAuditEntry({
      eventId: event.id,
      actionType: "event_archived",
      actorUserId: "user-different",
      createdAt: new Date(),
    });

    await backfillEventArchivedByUserId(prisma);

    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.archived_by_user_id).toBe("user-original");
  });

  it("is idempotent on a second run", async () => {
    const first = await backfillEventArchivedByUserId(prisma);
    expect(first.updated).toBe(0);
  });
});
