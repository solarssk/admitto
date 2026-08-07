import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestPrismaClient } from "@admitto/db/testing";
import { setMailSettings } from "@admitto/mailer-config";
import { generateToken } from "@admitto/tickets";
import { drainPendingDeliveries, sendTicketEmails } from "../src/index.js";
import { resetDb } from "./resetDb.js";

const prisma = createTestPrismaClient();
const EVENT_ID = "evt-mail-drain";
const EVENT_B = "evt-mail-drain-b";

beforeAll(async () => {
  await resetDb();
  await prisma.organization.create({
    data: { id: "org-drain", name: "Drain Org", slug: "drain-org" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      organization_id: "org-drain",
      title: "Drain Event",
      slug: "drain-event",
      date: new Date("2026-09-01"),
    },
  });
  await prisma.event.create({
    data: {
      id: EVENT_B,
      organization_id: "org-drain",
      title: "Drain Event B",
      slug: "drain-event-b",
      date: new Date("2026-09-02"),
    },
  });
  await setMailSettings(
    { scopeType: "organization", scopeId: "org-drain" },
    { provider: "export_only", fromAddress: "events@example.com" },
    prisma,
  );
  await prisma.attendee.create({
    data: {
      id: "att-drain-1",
      event_id: EVENT_ID,
      email: "drain1@example.com",
      name: "Drain One",
      public_ref: generateToken(),
    },
  });
  await prisma.attendee.create({
    data: {
      id: "att-drain-2",
      event_id: EVENT_ID,
      email: "drain2@example.com",
      name: "Drain Two",
      public_ref: generateToken(),
    },
  });
  await prisma.attendee.create({
    data: {
      id: "att-drain-b",
      event_id: EVENT_B,
      email: "drainb@example.com",
      name: "Drain B",
      public_ref: generateToken(),
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function enqueueOne(attendeeId: string, eventId = EVENT_ID) {
  return sendTicketEmails(
    eventId,
    { attendeeIds: [attendeeId] },
    prisma,
    { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
    { exportSink: () => undefined },
  );
}

describe("drainPendingDeliveries", () => {
  it("returns zeros when the queue is empty", async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: { in: [EVENT_ID, EVENT_B] } } });
    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      {},
      { eventId: EVENT_ID },
    );
    expect(drain).toEqual({ claimed: 0, sent: 0, failed: 0, skipped: 0 });
  });

  it("sends EmailDelivery rows left queued by sendTicketEmails enqueue", async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_ID } });
    const exported: Array<{ message: { to: string } }> = [];
    const enqueue = await sendTicketEmails(
      EVENT_ID,
      { attendeeIds: ["att-drain-1"] },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );
    expect(enqueue.queued).toBe(1);
    expect(enqueue.sent).toBe(0);
    expect(exported).toHaveLength(0);

    const queued = await prisma.emailDelivery.findMany({
      where: { event_id: EVENT_ID, status: "queued" },
    });
    expect(queued).toHaveLength(1);

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(drain).toEqual({ claimed: 1, sent: 1, failed: 0, skipped: 0 });
    expect(exported).toHaveLength(1);

    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: queued[0]!.id } });
    expect(after.status).toBe("accepted");
  });

  it("respects a custom limit and falls back for non-positive values", async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_ID } });
    await enqueueOne("att-drain-1");
    await enqueueOne("att-drain-2");

    const first = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, limit: 1, baseUrl: "https://tickets.example.com" },
    );
    expect(first.claimed).toBe(1);

    const remaining = await prisma.emailDelivery.count({
      where: { event_id: EVENT_ID, status: "queued" },
    });
    expect(remaining).toBe(1);

    // Non-positive limit uses DEFAULT_MAIL_DRAIN_LIMIT and drains the rest.
    const second = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, limit: 0, baseUrl: "https://tickets.example.com" },
    );
    expect(second.claimed).toBe(1);
    expect(second.sent).toBe(1);
  });

  it("groups queued rows across events into separate mailer sessions", async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: { in: [EVENT_ID, EVENT_B] } } });
    await enqueueOne("att-drain-1", EVENT_ID);
    await enqueueOne("att-drain-b", EVENT_B);

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { baseUrl: "https://tickets.example.com" },
    );
    expect(drain.claimed).toBe(2);
    expect(drain.sent).toBe(2);
  });

  it("retries retryable failed rows unless includeRetryableFailed is false", async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_ID } });
    await enqueueOne("att-drain-1");
    const queued = await prisma.emailDelivery.findFirstOrThrow({
      where: { event_id: EVENT_ID, status: "queued" },
    });
    await prisma.emailDelivery.update({
      where: { id: queued.id },
      data: { status: "failed", retryable: true, error: "soft fail" },
    });

    const skipped = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      {
        eventId: EVENT_ID,
        includeRetryableFailed: false,
        baseUrl: "https://tickets.example.com",
      },
    );
    expect(skipped.claimed).toBe(0);

    const retried = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" },
    );
    expect(retried).toEqual({ claimed: 1, sent: 1, failed: 0, skipped: 0 });
    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: queued.id } });
    expect(after.status).toBe("accepted");
  });

  it("uses resolveBaseUrl when options.baseUrl is omitted", async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_ID } });
    await enqueueOne("att-drain-1");

    const drain = await drainPendingDeliveries(
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://from-env.example.com" },
      { exportSink: () => undefined },
      { eventId: EVENT_ID },
    );
    expect(drain.sent).toBe(1);
  });
});
