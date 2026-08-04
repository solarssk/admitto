import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import type { ExportPayload } from "@admitto/mailer";
import { setMailSettings } from "@admitto/mailer-config";
import {
  BounceProbeSetupError,
  bounceProbeAttendeeEmail,
  cleanupLegacyBounceProbeAttendee,
  runEventBounceProbe,
} from "../src/bounceProbe.js";
import type { InboundMailProvider, InboundMessage } from "../src/bounceIngest/types.js";
import { resetDb } from "./resetDb.js";

const prisma = createTestPrismaClient();
const ORG_ID = "org-bounce-probe";
const EVENT_ID = "evt-bounce-probe";
const exported: ExportPayload[] = [];

const HARD_BODY =
  "nobody@example.com failed: host mx.example.com (203.0.113.1) said: 550 5.1.1 nobody@example.com: User unknown (in reply to RCPT TO command)";

function mockProvider(messages: InboundMessage[]): InboundMailProvider {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    fetchCandidateMessages: vi.fn().mockResolvedValue(messages),
    markSeen: vi.fn().mockResolvedValue(undefined),
    probeFolder: vi.fn().mockResolvedValue(undefined),
  };
}

beforeAll(async () => {
  await resetDb();
  await prisma.organization.create({
    data: { id: ORG_ID, name: "Bounce Probe Org", slug: "bounce-probe-org" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      organization_id: ORG_ID,
      title: "Bounce Probe Event",
      slug: "bounce-probe-event",
      date: new Date("2026-09-01"),
    },
  });
  await setMailSettings(
    { scopeType: "organization", scopeId: ORG_ID },
    { provider: "export_only", fromAddress: "org@example.com" },
    prisma,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("runEventBounceProbe", () => {
  it("rejects when bounce settings are missing", async () => {
    await expect(
      runEventBounceProbe(
        { eventId: EVENT_ID, toAddress: "nobody@example.com" },
        prisma,
        { NODE_ENV: "test" },
        { exportSink: (p) => exported.push(p) },
      ),
    ).rejects.toBeInstanceOf(BounceProbeSetupError);
  });

  it("sends like a transport test and reports ok when IMAP yields a hard bounce, without creating an attendee", async () => {
    exported.length = 0;
    await prisma.bounceIngestSettings.create({
      data: {
        event_id: EVENT_ID,
        imap_host: "imap.example.com",
        imap_port: 993,
        imap_username: "bounce@example.com",
        imap_password_enc: "enc",
        folders: ["INBOX"],
        enabled: true,
      },
    });

    let tick = 0;
    const messages: InboundMessage[] = [
      {
        uid: "1",
        folder: "INBOX",
        subject: "Undeliverable",
        bodyText: HARD_BODY,
        receivedAt: new Date(),
      },
    ];

    const result = await runEventBounceProbe(
      {
        eventId: EVENT_ID,
        toAddress: "nobody@example.com",
        timeoutMs: 100,
        pollMs: 1,
        now: () => {
          tick += 1;
          return tick * 10;
        },
        sleep: async () => undefined,
        ingestOptions: {
          createProvider: async () => mockProvider(messages),
        },
      },
      prisma,
      { NODE_ENV: "test" },
      { exportSink: (p) => exported.push(p) },
    );

    expect(result.status).toBe("ok");
    expect(result.smtpCode).toMatch(/^550/);
    expect(result.sendResult.status).toMatch(/accepted|sent/);
    expect(exported).toHaveLength(1);
    expect(exported[0]?.message.to).toBe("nobody@example.com");

    expect(await prisma.attendee.count({ where: { event_id: EVENT_ID } })).toBe(0);
    expect(await prisma.emailDelivery.count({ where: { event_id: EVENT_ID } })).toBe(0);
  });

  it("removes a legacy Bounce probe attendee left by older builds", async () => {
    const email = bounceProbeAttendeeEmail(EVENT_ID);
    const attendee = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email,
        name: "Bounce probe",
        status: "registered",
      },
    });
    await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: attendee.id,
        purpose: "resend",
        provider: "export_only",
        status: "bounced",
        attempts: 1,
        recipient_email: "old-probe@example.com",
        rendered_subject: "legacy",
        rendered_html: "<p>x</p>",
        template_label_snapshot: "Bounce probe",
      },
    });

    await cleanupLegacyBounceProbeAttendee(prisma, EVENT_ID);

    expect(
      await prisma.attendee.findUnique({
        where: { event_id_email: { event_id: EVENT_ID, email } },
      }),
    ).toBeNull();
    expect(await prisma.emailDelivery.count({ where: { event_id: EVENT_ID } })).toBe(0);
  });

  it("reports timeout when no bounce arrives", async () => {
    let t = 0;
    const result = await runEventBounceProbe(
      {
        eventId: EVENT_ID,
        toAddress: "still-nobody@example.com",
        timeoutMs: 30,
        pollMs: 5,
        now: () => {
          const v = t;
          t += 20;
          return v;
        },
        sleep: async () => undefined,
        ingestOptions: {
          createProvider: async () => mockProvider([]),
        },
      },
      prisma,
      { NODE_ENV: "test" },
      { exportSink: (p) => exported.push(p) },
    );

    expect(result.status).toBe("timeout");
    expect(result.message).toMatch(/90 seconds|IMAP/i);
  });
});
