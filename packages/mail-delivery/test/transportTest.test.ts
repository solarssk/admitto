import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setMailSettings } from "@admitto/mailer-config";
import type { ExportPayload, MailerConfig } from "@admitto/mailer";
import { resetDb } from "./resetDb.js";
import {
  absolutizeTransportTestLogo,
  buildEventTransportTestMessage,
  buildTransportTestMessage,
  resolveTransportTestHeaderLogo,
  sendEventTransportTestEmail,
  sendTransportTestEmail,
  transportTestFieldsFromConfig,
} from "../src/transportTest.js";

const prisma = createTestPrismaClient();
const ORG_ID = "org-transport-test";
const EVENT_ID = "evt-transport-test";
const EVENT_OVERRIDE_ID = "evt-transport-test-override";
const exported: ExportPayload[] = [];

beforeAll(async () => {
  await resetDb();

  await prisma.organization.create({
    data: {
      id: ORG_ID,
      name: "Transport Test Org",
      slug: "transport-test-org",
      logo_url: "/uploads/default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png",
    },
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
        logo_url: "https://cdn.example.com/event-logo.png",
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

describe("buildTransportTestMessage", () => {
  it("renders a branded card with diagnostics and no empty logo src", () => {
    const fixed = new Date("2026-08-04T20:09:47.000Z");
    const msg = buildTransportTestMessage(fixed, {
      scope: "organization",
      organizationName: "Acme <Org>",
      provider: "smtp",
      logoUrl: "https://cdn.example.com/logo.png",
      toAddress: "operator@example.com",
      fromAddress: "mailer@example.com",
      fromName: "Admitto Mail",
      host: "smtp.example.com",
      port: 587,
      replyTo: "noreply@example.com",
    });

    expect(msg.subject).toMatch(
      /^Admitto mail transport test \(2026-08-04 20:09:47 UTC - [a-f0-9]{8}\)$/,
    );
    expect(msg.html).toContain("Mail transport test");
    expect(msg.html).toContain("Diagnostics");
    expect(msg.html).toContain(msg.nonce);
    expect(msg.html).toContain("2026-08-04 20:09:47 UTC");
    expect(msg.html).toContain("SMTP");
    expect(msg.html).toContain("Organization: Acme &lt;Org&gt;");
    expect(msg.html).toContain("operator@example.com");
    expect(msg.html).toContain("Admitto Mail");
    expect(msg.html).toContain("&lt;mailer@example.com&gt;");
    expect(msg.html).toMatch(/Admitto Mail<\/div><div[^>]*>&lt;mailer@example.com&gt;/);
    expect(msg.html).toContain("smtp.example.com:587");
    expect(msg.html).toContain("noreply@example.com");
    expect(msg.html).toContain('src="https://cdn.example.com/logo.png"');
    expect(msg.html).toContain("Transport OK");
    expect(msg.html).toContain("&#10003;");
    expect(msg.html).toContain("Automated message from Admitto");
    expect(msg.html).not.toContain('src=""');
    expect(msg.html).not.toContain("border-radius:999px;");
  });

  it("falls back to Admitto text header when logo URL is omitted", () => {
    const msg = buildTransportTestMessage(new Date("2026-08-04T20:09:47.000Z"), {
      scope: "event",
      eventTitle: "Demo Night",
      provider: "graph",
    });
    expect(msg.html).toContain(">Admitto</span>");
    expect(msg.html).toContain("Event: Demo Night");
    expect(msg.html).toContain("Microsoft Graph");
    expect(msg.html).not.toContain("<img ");
  });

  it("renders Admitto mark + wordmark for the product logo fallback", () => {
    const msg = buildTransportTestMessage(new Date("2026-08-04T20:09:47.000Z"), {
      scope: "event",
      eventTitle: "Demo Night",
      logoUrl: "https://tickets.example.com/assets/admitto-mark.svg",
      logoKind: "admitto",
    });
    expect(msg.html).toContain('src="https://tickets.example.com/assets/admitto-mark.svg"');
    expect(msg.html).toContain(">Admitto</td>");
    expect(msg.html).not.toContain('width="140"');
  });
});

describe("absolutizeTransportTestLogo", () => {
  it("absolutizes /uploads paths with BASE_URL", () => {
    expect(
      absolutizeTransportTestLogo("/uploads/default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png", {
        NODE_ENV: "test",
        BASE_URL: "https://tickets.example.com",
      }),
    ).toBe(
      "https://tickets.example.com/uploads/default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png",
    );
  });

  it("returns null for empty or invalid logos", () => {
    expect(absolutizeTransportTestLogo(null, { NODE_ENV: "development" })).toBeNull();
    expect(absolutizeTransportTestLogo("not-a-url", { NODE_ENV: "development" })).toBeNull();
  });
});

describe("resolveTransportTestHeaderLogo", () => {
  it("prefers branding logo when present", () => {
    expect(
      resolveTransportTestHeaderLogo("/uploads/default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png", {
        NODE_ENV: "test",
        BASE_URL: "https://tickets.example.com",
      }),
    ).toEqual({
      url: "https://tickets.example.com/uploads/default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png",
      kind: "branding",
    });
  });

  it("falls back to the Admitto mark under BASE_URL when branding is missing", () => {
    expect(resolveTransportTestHeaderLogo(null, { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" })).toEqual(
      {
        url: "https://tickets.example.com/assets/admitto-mark.svg",
        kind: "admitto",
      },
    );
  });
});

describe("sendTransportTestEmail (org-scoped)", () => {
  it("sends a branded transport-level test message and does not create EmailDelivery", async () => {
    exported.length = 0;
    const before = await prisma.emailDelivery.count();

    const result = await sendTransportTestEmail(
      { organizationId: ORG_ID, toAddress: "operator@example.com" },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );

    expect(result.status).toBe("accepted");
    expect(result.provider).toBe("export_only");
    expect(exported).toHaveLength(1);
    expect(exported[0]?.message.to).toBe("operator@example.com");
    expect(exported[0]?.message.subject).toMatch(/^Admitto mail transport test \(/);
    expect(exported[0]?.message.html).toContain("Test id");
    expect(exported[0]?.message.html).toContain("Mail transport test");
    expect(exported[0]?.message.html).toContain(
      "https://tickets.example.com/uploads/default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png",
    );
    expect(exported[0]?.message.html).toContain("Organization: Transport Test Org");
    expect(exported[0]?.message.html).toContain("operator@example.com");
    expect(exported[0]?.message.html).toContain("org-transport@example.com");

    const after = await prisma.emailDelivery.count();
    expect(after).toBe(before);
  });

  it("uses a unique subject/body on each send so relays do not suppress duplicates", async () => {
    exported.length = 0;
    const deps = { exportSink: (p: ExportPayload) => exported.push(p) };
    const env = { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" };

    await sendTransportTestEmail(
      { organizationId: ORG_ID, toAddress: "same@example.com" },
      prisma,
      env,
      deps,
    );
    await sendTransportTestEmail(
      { organizationId: ORG_ID, toAddress: "same@example.com" },
      prisma,
      env,
      deps,
    );

    expect(exported).toHaveLength(2);
    expect(exported[0]?.message.subject).not.toBe(exported[1]?.message.subject);
    expect(exported[0]?.message.html).not.toBe(exported[1]?.message.html);
  });
});

describe("sendEventTransportTestEmail (event-scoped)", () => {
  it("falls back to the organization's transport when the event has no override", async () => {
    exported.length = 0;

    const result = await sendEventTransportTestEmail(
      { eventId: EVENT_ID, toAddress: "operator@example.com" },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );

    expect(result.status).toBe("accepted");
    expect(result.provider).toBe("export_only");
    expect(exported).toHaveLength(1);
    expect(exported[0]?.sender.fromAddress).toBe("org-transport@example.com");
    expect(exported[0]?.message.html).toContain("Event: Transport Test Event");
    expect(exported[0]?.message.html).toContain(
      "https://tickets.example.com/uploads/default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png",
    );
  });

  it("uses the event's dedicated transport when an override exists", async () => {
    exported.length = 0;

    const result = await sendEventTransportTestEmail(
      { eventId: EVENT_OVERRIDE_ID, toAddress: "operator@example.com" },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );

    expect(result.status).toBe("accepted");
    expect(exported).toHaveLength(1);
    expect(exported[0]?.sender.fromAddress).toBe("event-transport@example.com");
    expect(exported[0]?.message.html).toContain("https://cdn.example.com/event-logo.png");
  });
});

describe("buildEventTransportTestMessage", () => {
  it("builds an event-scoped branded message with org title and mail config fields", async () => {
    const fixed = new Date("2026-08-04T20:09:47.000Z");
    const msg = await buildEventTransportTestMessage(
      EVENT_OVERRIDE_ID,
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      {
        now: fixed,
        toAddress: "operator@example.com",
        mailConfig: {
          provider: "export_only",
          fromAddress: "event-transport@example.com",
        } as never,
      },
    );

    expect(msg.subject).toMatch(/^Admitto mail transport test \(2026-08-04 20:09:47 UTC - /);
    expect(msg.html).toContain("Event: Transport Test Event Override");
    expect(msg.html).toContain("Transport Test Org");
    expect(msg.html).toContain("operator@example.com");
    expect(msg.html).toContain("https://cdn.example.com/event-logo.png");
    expect(msg.nonce).toMatch(/^[a-f0-9]{8}$/);
  });

  it("includes only toAddress when mailConfig is omitted", async () => {
    const msg = await buildEventTransportTestMessage(
      EVENT_ID,
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { toAddress: "  tester@example.com  " },
    );
    expect(msg.html).toContain("tester@example.com");
    expect(msg.html).toContain("Event: Transport Test Event");
  });
});

describe("transportTestFieldsFromConfig", () => {
  it("maps SMTP host/port and optional fromName/replyTo", () => {
    const config = {
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      user: "u",
      password: "p",
      fromAddress: "from@example.com",
      fromName: "  Admitto  ",
      replyTo: "reply@example.com",
    } as MailerConfig;
    expect(transportTestFieldsFromConfig(config, "to@example.com")).toEqual({
      provider: "smtp",
      toAddress: "to@example.com",
      fromAddress: "from@example.com",
      fromName: "Admitto",
      replyTo: "reply@example.com",
      envelopeFrom: undefined,
      host: "smtp.example.com",
      port: 587,
    });
  });

  it("falls back Graph fromAddress to mailbox", () => {
    const config = {
      provider: "graph",
      tenantId: "t",
      clientId: "c",
      clientSecret: "s",
      mailbox: "mailbox@example.com",
      fromAddress: "  ",
    } as MailerConfig;
    expect(transportTestFieldsFromConfig(config, "to@example.com")).toMatchObject({
      provider: "graph",
      toAddress: "to@example.com",
      fromAddress: "mailbox@example.com",
      mailbox: "mailbox@example.com",
    });
  });

  it("maps powerautomate/export_only without host", () => {
    const config = {
      provider: "export_only",
      fromAddress: "export@example.com",
    } as MailerConfig;
    expect(transportTestFieldsFromConfig(config, "to@example.com")).toMatchObject({
      provider: "export_only",
      toAddress: "to@example.com",
      fromAddress: "export@example.com",
    });
  });
});
