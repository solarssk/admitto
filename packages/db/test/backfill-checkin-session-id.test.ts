import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { backfillCheckInSessionIds } from "../src/backfill-checkin-session-id.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const ORG_ID = "org-backfill-checkin-session";
const EVENT_ID = "evt-backfill-checkin-session";

let prisma: PrismaClient;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = new PrismaClient();
  await prisma.organization.create({
    data: { id: ORG_ID, name: "Org", slug: "org-backfill-checkin-session" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Gala",
      slug: "gala-backfill-checkin-session",
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeAttendee(id: string) {
  return prisma.attendee.create({
    data: { id, event_id: EVENT_ID, email: `${id}@example.com`, name: id },
  });
}

describe("backfillCheckInSessionIds", () => {
  it("recovers session_id from the matching check_in action log entry", async () => {
    const attendee = await makeAttendee("att-backfill-recoverable");
    const checkIn = await prisma.checkIn.create({
      data: {
        attendee_id: attendee.id,
        event_id: EVENT_ID,
        status: "VALID",
        source: "scan",
        device_id: "Tablet 1",
        session_id: null,
      },
    });
    await prisma.attendeeActionLog.create({
      data: {
        event_id: EVENT_ID,
        attendee_id: attendee.id,
        action_type: "check_in",
        session_id: "sess-original",
        metadata: { method: "scan", check_in_id: checkIn.id },
      },
    });

    const result = await backfillCheckInSessionIds(prisma);
    expect(result.updated).toBeGreaterThanOrEqual(1);

    const after = await prisma.checkIn.findUniqueOrThrow({ where: { id: checkIn.id } });
    expect(after.session_id).toBe("sess-original");
  });

  it("leaves a check-in with no matching action log entry untouched", async () => {
    const attendee = await makeAttendee("att-backfill-orphan");
    const checkIn = await prisma.checkIn.create({
      data: {
        attendee_id: attendee.id,
        event_id: EVENT_ID,
        status: "VALID",
        source: "scan",
        device_id: null,
        session_id: null,
      },
    });

    await backfillCheckInSessionIds(prisma);

    const after = await prisma.checkIn.findUniqueOrThrow({ where: { id: checkIn.id } });
    expect(after.session_id).toBeNull();
  });

  it("does not overwrite a check-in that already has a session_id", async () => {
    const attendee = await makeAttendee("att-backfill-already-set");
    const checkIn = await prisma.checkIn.create({
      data: {
        attendee_id: attendee.id,
        event_id: EVENT_ID,
        status: "VALID",
        source: "scan",
        session_id: "sess-already-set",
      },
    });
    await prisma.attendeeActionLog.create({
      data: {
        event_id: EVENT_ID,
        attendee_id: attendee.id,
        action_type: "check_in",
        session_id: "sess-different",
        metadata: { method: "scan", check_in_id: checkIn.id },
      },
    });

    await backfillCheckInSessionIds(prisma);

    const after = await prisma.checkIn.findUniqueOrThrow({ where: { id: checkIn.id } });
    expect(after.session_id).toBe("sess-already-set");
  });

  it("is idempotent on a second run", async () => {
    const first = await backfillCheckInSessionIds(prisma);
    expect(first.updated).toBe(0);
  });
});
