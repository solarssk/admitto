import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const ORG_ID = "org-status-check";
const EVENT_ID = "evt-status-check";

let prisma: PrismaClient | undefined;
let attendeeId = "";
let eventItemId = "";

async function expectCheckViolation(
  action: () => Promise<unknown>,
  constraintName: string,
): Promise<void> {
  try {
    await action();
  } catch (err) {
    expect(err).toMatchObject({
      code: "P2010",
      meta: expect.objectContaining({ code: "23514" }),
    });
    expect(String((err as { meta?: { message?: unknown } }).meta?.message ?? err)).toContain(
      constraintName,
    );
    return;
  }
  throw new Error(`Expected ${constraintName} check violation`);
}

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");

  execSync("npx prisma migrate reset --force --skip-seed", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });

  prisma = new PrismaClient();
  await prisma.organization.create({
    data: { id: ORG_ID, name: "Status Check Org", slug: "status-check" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Status Check",
      slug: "status-check",
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
    },
  });
  const attendee = await prisma.attendee.create({
    data: {
      event_id: EVENT_ID,
      email: "status-check@example.com",
      name: "Status Check",
    },
  });
  attendeeId = attendee.id;
  const eventItem = await prisma.eventItem.create({
    data: {
      event_id: EVENT_ID,
      key: "badge",
      label: "Badge",
    },
  });
  eventItemId = eventItem.id;
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("status DB check constraints", () => {
  it("rejects invalid Attendee.status values", async () => {
    await prisma!.$executeRaw`UPDATE "Attendee" SET "status" = 'confirmed' WHERE "id" = ${attendeeId}`;

    await expectCheckViolation(
      () => prisma!.$executeRaw`UPDATE "Attendee" SET "status" = 'bogus' WHERE "id" = ${attendeeId}`,
      "Attendee_status_check",
    );
  });

  it("allows Attendee.status revoked", async () => {
    await prisma!.$executeRaw`UPDATE "Attendee" SET "status" = 'revoked' WHERE "id" = ${attendeeId}`;
    const row = await prisma!.attendee.findUnique({ where: { id: attendeeId }, select: { status: true } });
    expect(row?.status).toBe("revoked");
  });

  it("rejects non-persisted CheckIn.status values", async () => {
    await prisma!.checkIn.create({
      data: {
        attendee_id: attendeeId,
        event_id: EVENT_ID,
        status: "VALID",
      },
    });

    await expectCheckViolation(
      () =>
        prisma!.$executeRaw`INSERT INTO "CheckIn" ("id", "attendee_id", "event_id", "status") VALUES ('checkin-invalid-status', ${attendeeId}, ${EVENT_ID}, 'INVALID')`,
      "CheckIn_status_check",
    );
  });

  it("rejects invalid AttendeeItemState.state values", async () => {
    await prisma!.attendeeItemState.create({
      data: {
        attendee_id: attendeeId,
        event_item_id: eventItemId,
        state: "pending",
      },
    });

    await expectCheckViolation(
      () =>
        prisma!.$executeRaw`UPDATE "AttendeeItemState" SET "state" = 'bogus' WHERE "attendee_id" = ${attendeeId} AND "event_item_id" = ${eventItemId}`,
      "AttendeeItemState_state_check",
    );
  });
});
