import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setMailSettings } from "@admitto/mailer-config";
import type { ExportPayload } from "@admitto/mailer";
import { resetDb } from "./resetDb.js";
import { sendTestEmail } from "../src/testSend.js";

const prisma = new PrismaClient();
const EVENT_ID = "evt-test-send";
const exported: ExportPayload[] = [];

beforeAll(async () => {
  await resetDb();

  await prisma.organization.create({
    data: { id: "org-test-send", name: "Test Send Org", slug: "test-send-org" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      organization_id: "org-test-send",
      title: "Test Send Event",
      slug: "test-send-event",
      date: new Date("2026-09-01"),
      location: "Warsaw",
    },
  });

  await setMailSettings(
    { scopeType: "organization", scopeId: "org-test-send" },
    { provider: "export_only", fromAddress: "events@example.com" },
    prisma,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sendTestEmail", () => {
  it("sends one mail with sample data and does not create EmailDelivery", async () => {
    exported.length = 0;
    const beforeCount = await prisma.emailDelivery.count({ where: { event_id: EVENT_ID } });

    const result = await sendTestEmail(
      { eventId: EVENT_ID, toAddress: "operator@example.com" },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );

    expect(result.status).toBe("accepted");
    expect(result.provider).toBe("export_only");
    expect(exported).toHaveLength(1);
    expect(exported[0]?.message.to).toBe("operator@example.com");
    expect(exported[0]?.message.html).toContain("sample-token");
    expect(exported[0]?.message.html).not.toMatch(/\/t\/[A-Za-z0-9_-]{40,}/);

    const afterCount = await prisma.emailDelivery.count({ where: { event_id: EVENT_ID } });
    expect(afterCount).toBe(beforeCount);
  });
});
