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
  it("sends one mail with sample data, placeholder QR/link (not a broken sample-token URL), and does not create EmailDelivery", async () => {
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
    // The sample ticket_url/qr_image_url point at a domain nothing hosts - sanitized to a
    // same-origin-safe placeholder rather than left as a dead link/broken image in a real inbox.
    expect(exported[0]?.message.html).not.toContain("tickets.example.com");
    expect(exported[0]?.message.html).toContain("data:image/svg+xml");
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

describe("sendTestEmail for a system mail by name", () => {
  const env = { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" };

  async function sendByName(name: string) {
    exported.length = 0;
    const result = await sendTestEmail(
      { eventId: EVENT_ID, toAddress: "operator@example.com", templateName: name },
      prisma,
      env,
      { exportSink: (p) => exported.push(p) },
    );
    expect(result.status).toBe("accepted");
    expect(exported).toHaveLength(1);
    return exported[0]!.message;
  }

  afterAll(async () => {
    await prisma.mailTemplate.deleteMany({ where: { scope_id: { in: [EVENT_ID, "org-test-send"] }, name: { startsWith: "registration-" } } });
    await prisma.eventContact.deleteMany({ where: { event_id: EVENT_ID } });
  });

  it("renders the built-in default when the event has no row of that name, without touching the ticket template", async () => {
    const message = await sendByName("registration-waitlist");
    expect(message.subject).toBe("You are on the waiting list for Test Send Event");
    expect(message.html).toContain("waiting list");
    expect(message.html).not.toContain("{{");
  });

  it("sends the confirmation mail with its button going nowhere, not to the sample link of a page that does not exist", async () => {
    const message = await sendByName("registration-confirm");
    expect(message.subject).toBe("Confirm your email for Test Send Event");
    expect(message.html).toContain("Confirm email address");
    expect(message.html).toContain('href="#"');
    expect(message.html).not.toContain("sample-id.sample-mac");
    expect(message.html).not.toContain("tickets.example.com");
  });

  it("uses the event's own contact in place of the sample one, and no contact line when it has none", async () => {
    expect((await sendByName("registration-received")).html).not.toContain("Questions?");

    await prisma.eventContact.create({
      data: { event_id: EVENT_ID, name: "Ann Organizer", email: "ann@example.com" },
    });
    expect((await sendByName("registration-received")).html).toContain("Questions? Contact Ann Organizer at ann@example.com.");
    expect((await sendByName("registration-received")).html).not.toContain("organizer@example.com");
  });

  it("renders the event's own row of that name in preference to the built-in default", async () => {
    await setMailTemplate(
      { scopeType: "event", scopeId: EVENT_ID, name: "registration-rejected" },
      { subject: "Sorry about {{event_name}}", body: "<p>Not this time.</p>", format: "html" },
      prisma,
    );
    const message = await sendByName("registration-rejected");
    expect(message.subject).toBe("Sorry about Test Send Event");
    expect(message.html).toContain("Not this time.");
  });

  it("falls back to the organization's row before the built-in default", async () => {
    await setMailTemplate(
      { scopeType: "organization", scopeId: "org-test-send", name: "registration-confirm" },
      { subject: "Org confirm {{event_name}}", body: '<p>Org text <a href="{{confirm_url}}">go</a></p>', format: "html" },
      prisma,
    );
    expect((await sendByName("registration-confirm")).subject).toBe("Org confirm Test Send Event");
  });

  it("prefers a template id over a name when both are given", async () => {
    const row = await prisma.mailTemplate.findFirstOrThrow({
      where: { scope_type: "event", scope_id: EVENT_ID, name: "registration-rejected" },
    });
    exported.length = 0;
    await sendTestEmail(
      { eventId: EVENT_ID, toAddress: "operator@example.com", templateId: row.id, templateName: "registration-waitlist" },
      prisma,
      env,
      { exportSink: (p) => exported.push(p) },
    );
    expect(exported[0]?.message.subject).toBe("Sorry about Test Send Event");
  });
});
