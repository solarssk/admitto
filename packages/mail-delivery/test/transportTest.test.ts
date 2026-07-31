import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setMailSettings } from "@admitto/mailer-config";
import type { ExportPayload } from "@admitto/mailer";
import { resetDb } from "./resetDb.js";
import { sendEventTransportTestEmail, sendTransportTestEmail } from "../src/transportTest.js";

const prisma = createTestPrismaClient();
const ORG_ID = "org-transport-test";
const EVENT_ID = "evt-transport-test";
const EVENT_OVERRIDE_ID = "evt-transport-test-override";
const exported: ExportPayload[] = [];

beforeAll(async () => {
  await resetDb();

  await prisma.organization.create({
    data: { id: ORG_ID, name: "Transport Test Org", slug: "transport-test-org" },
  });
  await prisma.event.createMany({
    data: [
      {
        id: EVENT_ID,
        organization_id: ORG_ID,
        title: "Transport Test Event",
        slug: "transport-test-event",
        date: new Date("2026-09-01"),
      },
      {
        id: EVENT_OVERRIDE_ID,
        organization_id: ORG_ID,
        title: "Transport Test Event Override",
        slug: "transport-test-event-override",
        date: new Date("2026-09-02"),
      },
    ],
  });

  await setMailSettings(
    { scopeType: "organization", scopeId: ORG_ID },
    { provider: "export_only", fromAddress: "org-transport@example.com" },
    prisma,
  );
  await setMailSettings(
    { scopeType: "event", scopeId: EVENT_OVERRIDE_ID },
    { provider: "export_only", fromAddress: "event-transport@example.com" },
    prisma,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sendTransportTestEmail (org-scoped)", () => {
  it("sends a trivial transport-level test message and does not create EmailDelivery", async () => {
    exported.length = 0;
    const before = await prisma.emailDelivery.count();

    const result = await sendTransportTestEmail(
      { organizationId: ORG_ID, toAddress: "operator@example.com" },
      prisma,
      { NODE_ENV: "test" },
      { exportSink: (p) => exported.push(p) },
    );

    expect(result.status).toBe("accepted");
    expect(result.provider).toBe("export_only");
    expect(exported).toHaveLength(1);
    expect(exported[0]?.message.to).toBe("operator@example.com");
    expect(exported[0]?.message.subject).toBe("Admitto mail transport test");

    const after = await prisma.emailDelivery.count();
    expect(after).toBe(before);
  });
});

describe("sendEventTransportTestEmail (event-scoped)", () => {
  it("falls back to the organization's transport when the event has no override", async () => {
    exported.length = 0;

    const result = await sendEventTransportTestEmail(
      { eventId: EVENT_ID, toAddress: "operator@example.com" },
      prisma,
      { NODE_ENV: "test" },
      { exportSink: (p) => exported.push(p) },
    );

    expect(result.status).toBe("accepted");
    expect(result.provider).toBe("export_only");
    expect(exported).toHaveLength(1);
    expect(exported[0]?.sender.fromAddress).toBe("org-transport@example.com");
  });

  it("uses the event's dedicated transport when an override exists", async () => {
    exported.length = 0;

    const result = await sendEventTransportTestEmail(
      { eventId: EVENT_OVERRIDE_ID, toAddress: "operator@example.com" },
      prisma,
      { NODE_ENV: "test" },
      { exportSink: (p) => exported.push(p) },
    );

    expect(result.status).toBe("accepted");
    expect(exported).toHaveLength(1);
    expect(exported[0]?.sender.fromAddress).toBe("event-transport@example.com");
  });
});
