import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createTestPrismaClient } from "../src/testing.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const ORG_ID = "worker-wake-notify-org";
const EVENT_ID = "worker-wake-notify-event";
const ATTENDEE_ID = "worker-wake-notify-attendee";
const WAKE_CHANNEL = "admitto_worker_wake";

let prisma: PrismaClient | undefined;
let listener: InstanceType<typeof Client> | undefined;

function waitForNotification(timeoutMs = 2000): Promise<{ channel: string; payload?: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for pg_notify")),
      timeoutMs,
    );
    listener!.once("notification", (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
}

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma migrate reset --force", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = createTestPrismaClient();

  listener = new Client({ connectionString: process.env.DATABASE_URL });
  await listener.connect();
  await listener.query(`LISTEN ${WAKE_CHANNEL}`);

  await prisma.organization.create({
    data: { id: ORG_ID, name: "Worker Wake Notify", slug: "worker-wake-notify" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Worker Wake Notify Event",
      slug: "worker-wake-notify-event",
      date: new Date("2026-09-01T09:00:00Z"),
      organization_id: ORG_ID,
    },
  });
  await prisma.attendee.create({
    data: {
      id: ATTENDEE_ID,
      event_id: EVENT_ID,
      email: "worker-wake-notify@example.com",
      name: "Worker Wake Notify",
    },
  });
});

afterAll(async () => {
  await listener?.end();
  await prisma?.$disconnect();
});

// Covers packages/db/prisma/migrations/20260813170000_worker_wake_notify_trigger — the worker
// LISTENs on this channel (apps/cli/src/commands/worker-notify.ts) to pick up export/import/mail
// jobs immediately instead of waiting for the next fixed poll tick.
describe("admitto_worker_wake trigger", () => {
  it("notifies on AdminJob insert", async () => {
    const notified = waitForNotification();
    await prisma!.adminJob.create({
      data: {
        id: "wake-test-admin-job",
        type: "export",
        status: "pending",
        organization_id: ORG_ID,
      },
    });
    await expect(notified).resolves.toMatchObject({ channel: WAKE_CHANNEL, payload: "AdminJob" });
  });

  it("notifies on EmailDelivery insert with status queued", async () => {
    const notified = waitForNotification();
    await prisma!.emailDelivery.create({
      data: {
        id: "wake-test-delivery-1",
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: ATTENDEE_ID,
        provider: "test",
        status: "queued",
      },
    });
    await expect(notified).resolves.toMatchObject({
      channel: WAKE_CHANNEL,
      payload: "EmailDelivery",
    });
  });

  it("notifies when a failed delivery is retried back to queued (UPDATE, not INSERT)", async () => {
    await prisma!.emailDelivery.create({
      data: {
        id: "wake-test-delivery-2",
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: ATTENDEE_ID,
        purpose: "resend", // partial unique index on (attendee_id, event_id) only covers purpose="initial"
        provider: "test",
        status: "failed",
        retryable: true,
      },
    });

    const notified = waitForNotification();
    await prisma!.emailDelivery.update({
      where: { id: "wake-test-delivery-2" },
      data: { status: "queued" },
    });
    await expect(notified).resolves.toMatchObject({
      channel: WAKE_CHANNEL,
      payload: "EmailDelivery",
    });
  });

  it("does not notify when a delivery transitions away from queued", async () => {
    const insertNotified = waitForNotification();
    await prisma!.emailDelivery.create({
      data: {
        id: "wake-test-delivery-3",
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: ATTENDEE_ID,
        purpose: "resend",
        provider: "test",
        status: "queued",
      },
    });
    await insertNotified; // drain the insert's own notification first

    let notified = false;
    const onNotification = () => {
      notified = true;
    };
    listener!.once("notification", onNotification);
    await prisma!.emailDelivery.update({
      where: { id: "wake-test-delivery-3" },
      data: { status: "sent" },
    });
    await new Promise((r) => setTimeout(r, 300));
    listener!.removeListener("notification", onNotification);
    expect(notified).toBe(false);
  });
});
