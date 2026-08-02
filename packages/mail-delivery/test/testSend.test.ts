import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setMailTemplate } from "@admitto/mail-templates";
import { setMailSettings } from "@admitto/mailer-config";
import type { ExportPayload } from "@admitto/mailer";
import { resetDb } from "./resetDb.js";
import { sendTestEmail } from "../src/testSend.js";

const prisma = createTestPrismaClient();
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

  it("uses explicit baseUrl without BASE_URL in env", async () => {
    exported.length = 0;
    const result = await sendTestEmail(
      { eventId: EVENT_ID, toAddress: "operator@example.com" },
      prisma,
      { NODE_ENV: "test" },
      { exportSink: (p) => exported.push(p) },
      { baseUrl: "https://tickets.example.com" },
    );
    expect(result.status).toBe("accepted");
    expect(exported).toHaveLength(1);
  });

  it("omits event_map_url when LOCATION_MAPS_ENABLED=false despite a saved pin", async () => {
    await prisma.eventLocation.create({
      data: {
        event_id: EVENT_ID,
        venue_name: "Test venue",
        latitude: 52.2297,
        longitude: 21.0122,
      },
    });
    await setMailTemplate(
      { scopeType: "event", scopeId: EVENT_ID },
      {
        subject: "Test",
        body: '<img src="{{event_map_url}}" alt="Map" />',
        format: "html",
      },
      prisma,
    );

    exported.length = 0;
    const result = await sendTestEmail(
      { eventId: EVENT_ID, toAddress: "operator@example.com" },
      prisma,
      {
        NODE_ENV: "test",
        BASE_URL: "https://tickets.example.com",
        LOCATION_MAPS_ENABLED: "false",
      },
      { exportSink: (p) => exported.push(p) },
    );

    expect(result.status).toBe("accepted");
    // Empty optional URL placeholders omit the attribute entirely (no src="").
    expect(exported[0]?.message.html).toContain("<img alt=\"Map\" />");
    expect(exported[0]?.message.html).not.toContain("/m/evt-test-send.png");
  });
});
