import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestPrismaClient } from "@admitto/db/testing";
import { setMailSettings } from "@admitto/mailer-config";
import { generateToken } from "@admitto/tickets";
import { drainPendingDeliveries, sendTicketEmails } from "../src/index.js";
import { resetDb } from "./resetDb.js";

const prisma = createTestPrismaClient();
const EVENT_ID = "evt-mail-drain";

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
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("drainPendingDeliveries", () => {
  it("sends EmailDelivery rows left queued by sendTicketEmails enqueue", async () => {
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
});
