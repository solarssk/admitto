import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as mailDelivery from "@admitto/mail-delivery";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { DEFAULT_BODY_MJML, DEFAULT_SUBJECT_TEMPLATE } from "@admitto/mail-templates";
import type { ExportPayload } from "@admitto/mailer";
import { setMailSettings } from "@admitto/mailer-config";
import { createApp } from "../../src/app.js";
import { createRateLimitStore, type InMemoryRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_A = "org-multi-tpl-a";
const EVENT_A = "evt-multi-tpl-a";
const EVENT_B = "evt-multi-tpl-b";
const EMAIL_ADMIN = "multi-tpl-admin@example.com";
// A second admin user, used only by the ticket_type filter tests below - the shared adminCookie
// user already spends 2 of its 3 allotted admin:resend-bulk requests (600s window) on the
// pre-existing dryRun tests in this file, and a 4th call for the same user would 429.
const EMAIL_ADMIN_2 = "multi-tpl-admin-2@example.com";
const PASSWORD = "multi-tpl-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let adminCookie = "";
let admin2Cookie = "";
const exported: ExportPayload[] = [];

const validTemplate = {
  subject_template: DEFAULT_SUBJECT_TEMPLATE,
  body_template: DEFAULT_BODY_MJML,
  template_format: "mjml" as const,
};

async function seed(client: PrismaClient) {
  await client.emailDelivery.deleteMany({ where: { event_id: EVENT_A } });
  await client.mailTemplate.deleteMany({
    where: { scope_id: { in: [EVENT_A, EVENT_B, ORG_A] } },
  });
  await client.attendee.deleteMany({ where: { event_id: EVENT_A } });
  await client.roleAssignment.deleteMany({ where: { scope_id: { in: [ORG_A, EVENT_A] } } });
  await client.session.deleteMany({ where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_ADMIN_2] } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_ADMIN_2] } } } });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN, EMAIL_ADMIN_2] } } });
  await client.event.deleteMany({ where: { id: { in: [EVENT_A, EVENT_B] } } });
  await client.organization.deleteMany({ where: { id: ORG_A } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.create({
    data: { id: ORG_A, name: "Org", slug: "multi-tpl-org" },
  });
  await setMailSettings(
    { scopeType: "organization", scopeId: ORG_A },
    { provider: "export_only", fromAddress: "events@example.com" },
    client,
  );
  await client.event.create({
    data: {
      id: EVENT_A,
      title: "Event",
      slug: "multi-tpl-event",
      date: new Date("2026-10-01"),
      organization_id: ORG_A,
    },
  });

  await client.ticketType.createMany({
    data: [{ event_id: EVENT_A, key: "vip", label: "VIP", color: "purple" }],
  });

  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  await client.roleAssignment.create({
    data: { user_id: adminUser.id, role: "admin", scope_type: "organization", scope_id: ORG_A },
  });
  await client.userMfaMethod.create({
    data: {
      user_id: adminUser.id,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });

  const { rawToken } = await createSession(client, { userId: adminUser.id, stage: SESSION_STAGE.FULL });
  adminCookie = `admitto_session=${rawToken}`;

  const admin2 = await client.user.create({ data: { email: EMAIL_ADMIN_2, password_hash } });
  await client.roleAssignment.create({
    data: { user_id: admin2.id, role: "admin", scope_type: "organization", scope_id: ORG_A },
  });
  await client.userMfaMethod.create({
    data: {
      user_id: admin2.id,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });
  const admin2Session = await createSession(client, { userId: admin2.id, stage: SESSION_STAGE.FULL });
  admin2Cookie = `admitto_session=${admin2Session.rawToken}`;
}

async function resetEventAState(client: PrismaClient) {
  await client.attendeeActionLog.deleteMany({ where: { event_id: EVENT_A } });
  await client.emailDelivery.deleteMany({ where: { event_id: EVENT_A } });
  await client.mailTemplate.deleteMany({ where: { scope_id: EVENT_A } });
  await client.attendee.deleteMany({ where: { event_id: EVENT_A } });
}

async function putTicketTemplate(
  testApp: ReturnType<typeof createApp>,
  eventId = EVENT_A,
) {
  const res = await testApp.request(`/api/admin/events/${eventId}/template`, {
    method: "PUT",
    headers: {
      Cookie: adminCookie,
      "Content-Type": "application/json",
      ...sameOrigin,
    },
    body: JSON.stringify(validTemplate),
  });
  expect(res.status).toBe(200);
}

async function postNamedTemplate(
  testApp: ReturnType<typeof createApp>,
  label: string,
  eventId = EVENT_A,
) {
  const res = await testApp.request(`/api/admin/events/${eventId}/templates`, {
    method: "POST",
    headers: {
      Cookie: adminCookie,
      "Content-Type": "application/json",
      ...sameOrigin,
    },
    body: JSON.stringify({ label, template_format: "mjml" }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; name: string; label: string };
}

async function ensureEventB(client: PrismaClient) {
  const existing = await client.event.findUnique({ where: { id: EVENT_B } });
  if (existing) return;
  await client.event.create({
    data: {
      id: EVENT_B,
      title: "Event B",
      slug: "multi-tpl-event-b",
      date: new Date("2026-11-01"),
      organization_id: ORG_A,
    },
  });
}

async function ensureEventBForeignTemplate(
  testApp: ReturnType<typeof createApp>,
  client: PrismaClient,
) {
  await client.mailTemplate.deleteMany({ where: { scope_id: EVENT_B } });
  await ensureEventB(client);
  const body = await postNamedTemplate(testApp, "Ticket", EVENT_B);
  expect(body.name).toBe("ticket_2");
  return body;
}

describe("multi-template API", () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    await seed(prisma);
    app = createApp({
      prisma,
      checkinToken: "multi-tpl-checkin-token-32chars!!",
      allowCheckinBearer: true,
      baseUrl: "https://tickets.example.com",
      rateLimitStore: (rateLimitStore = createRateLimitStore() as InMemoryRateLimitStore),
      skipCheckinBootValidation: true,
      adminDistRoot,
      mailDeliveryDeps: { exportSink: (p) => { exported.push(p); } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    exported.length = 0;
    await resetEventAState(prisma);
  });

  it("PUT /template creates ticket template with name=ticket", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/template`, {
      method: "PUT",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify(validTemplate),
    });
    expect(res.status).toBe(200);

    const row = await prisma.mailTemplate.findUnique({
      where: {
        scope_type_scope_id_name: { scope_type: "event", scope_id: EVENT_A, name: "ticket" },
      },
    });
    expect(row?.name).toBe("ticket");
    expect(row?.label).toBe("Ticket email");
  });

  it("GET /templates lists event templates", async () => {
    await putTicketTemplate(app);
    const res = await app.request(`/api/admin/events/${EVENT_A}/templates`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { name: string }[] };
    expect(body.items.some((t) => t.name === "ticket")).toBe(true);
  });

  it("POST /templates creates custom template", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/templates`, {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ label: "Reminder", template_format: "mjml" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; label: string };
    expect(body.name).toBe("reminder");
    expect(body.label).toBe("Reminder");
  });

  it("POST /templates label Ticket does not create primary ticket template", async () => {
    await ensureEventB(prisma);

    const res = await app.request(`/api/admin/events/${EVENT_B}/templates`, {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ label: "Ticket", template_format: "mjml" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("ticket_2");

    const primary = await prisma.mailTemplate.findUnique({
      where: {
        scope_type_scope_id_name: { scope_type: "event", scope_id: EVENT_B, name: "ticket" },
      },
    });
    expect(primary).toBeNull();
  });

  it("DELETE blocks ticket template", async () => {
    await putTicketTemplate(app);
    const ticket = await prisma.mailTemplate.findUniqueOrThrow({
      where: {
        scope_type_scope_id_name: { scope_type: "event", scope_id: EVENT_A, name: "ticket" },
      },
    });
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/templates/${ticket.id}`,
      {
        method: "DELETE",
        headers: { Cookie: adminCookie, ...sameOrigin },
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("template_required");
  });

  it("DELETE allows unused reminder template", async () => {
    const reminder = await postNamedTemplate(app, "Reminder");
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/templates/${reminder.id}`,
      {
        method: "DELETE",
        headers: { Cookie: adminCookie, ...sameOrigin },
      },
    );
    expect(res.status).toBe(200);
  });

  it("DELETE allows reminder template when deliveries exist and nullifies template_id", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_A}/templates`, {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ label: "Reminder", template_format: "mjml" }),
    });
    expect(createRes.status).toBe(201);
    const reminder = (await createRes.json()) as { id: string };

    const attendee = await prisma.attendee.create({
      data: {
        id: "att-reminder-del",
        event_id: EVENT_A,
        email: "reminder-del@example.com",
        name: "Reminder Del",
      },
    });
    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_A,
        event_id: EVENT_A,
        attendee_id: attendee.id,
        template_id: reminder.id,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
      },
    });
    expect(delivery.template_id).toBe(reminder.id);

    const res = await app.request(
      `/api/admin/events/${EVENT_A}/templates/${reminder.id}`,
      {
        method: "DELETE",
        headers: { Cookie: adminCookie, ...sameOrigin },
      },
    );
    expect(res.status).toBe(200);

    const deleted = await prisma.mailTemplate.findUnique({ where: { id: reminder.id } });
    expect(deleted).toBeNull();

    const updatedDelivery = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(updatedDelivery.template_id).toBeNull();
  });

  it("DELETE allows custom template when deliveries exist and nullifies template_id", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_A}/templates`, {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ label: "Promo blast", template_format: "mjml" }),
    });
    expect(createRes.status).toBe(201);
    const custom = (await createRes.json()) as { id: string; name: string };
    expect(custom.name).not.toBe("ticket");
    expect(custom.name).not.toBe("reminder");

    const attendee = await prisma.attendee.create({
      data: {
        id: "att-custom-del",
        event_id: EVENT_A,
        email: "custom-del@example.com",
        name: "Custom Del",
      },
    });
    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_A,
        event_id: EVENT_A,
        attendee_id: attendee.id,
        template_id: custom.id,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
      },
    });
    expect(delivery.template_id).toBe(custom.id);

    const res = await app.request(
      `/api/admin/events/${EVENT_A}/templates/${custom.id}`,
      {
        method: "DELETE",
        headers: { Cookie: adminCookie, ...sameOrigin },
      },
    );
    expect(res.status).toBe(200);

    const deleted = await prisma.mailTemplate.findUnique({ where: { id: custom.id } });
    expect(deleted).toBeNull();

    const updatedDelivery = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(updatedDelivery.template_id).toBeNull();
  });

  it("POST /send dryRun returns recipientCount", async () => {
    await putTicketTemplate(app);
    const ticket = await prisma.mailTemplate.findUniqueOrThrow({
      where: {
        scope_type_scope_id_name: { scope_type: "event", scope_id: EVENT_A, name: "ticket" },
      },
    });
    await prisma.attendee.create({
      data: {
        id: "att-multi-1",
        event_id: EVENT_A,
        email: "guest@example.com",
        name: "Guest",
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/send`, {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({
        templateId: ticket.id,
        filter: { type: "attendee_ids", ids: ["att-multi-1"] },
        dryRun: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recipientCount: number };
    expect(body.recipientCount).toBe(1);
  });

  it("POST /send with no templateId (and no persisted 'ticket' template anywhere) still dry-runs, via the built-in default template", async () => {
    // Deliberately does NOT call putTicketTemplate - EVENT_A has no persisted template at
    // all here (resetEventAState clears it every test), and ORG_A never gets one in seed().
    await prisma.attendee.create({
      data: {
        id: "att-multi-builtin-dry",
        event_id: EVENT_A,
        email: "builtin-dry@example.com",
        name: "Guest",
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/send`, {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({
        filter: { type: "attendee_ids", ids: ["att-multi-builtin-dry"] },
        dryRun: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recipientCount: number };
    expect(body.recipientCount).toBe(1);
  });

  it("POST /send with no templateId actually sends using the built-in default template content", async () => {
    await prisma.attendee.create({
      data: {
        id: "att-multi-builtin-send",
        event_id: EVENT_A,
        email: "builtin-send@example.com",
        name: "Guest",
      },
    });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_A}/send`, {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          "Content-Type": "application/json",
          ...sameOrigin,
        },
        body: JSON.stringify({
          filter: { type: "attendee_ids", ids: ["att-multi-builtin-send"] },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { queued: number; skipped: number; failed: number };
      expect(body.queued).toBe(1);
      expect(body.failed).toBe(0);

      expect(exported.length).toBe(1);
      expect(exported[0]?.message.subject).toBe("Your ticket for Event");
      expect(exported[0]?.message.to).toBe("builtin-send@example.com");

      const delivery = await prisma.emailDelivery.findFirstOrThrow({
        where: { event_id: EVENT_A, attendee_id: "att-multi-builtin-send" },
      });
      // Same convention a builtin-sourced send already uses elsewhere: no real template row
      // backs it, so template_id stays null rather than pointing at something that doesn't exist.
      expect(delivery.template_id).toBeNull();
    } finally {
      rateLimitStore.reset();
    }
  });

  it("POST /send returns 422 mail_not_configured instead of a raw 500 when no mail transport is set up", async () => {
    await putTicketTemplate(app);
    const ticket = await prisma.mailTemplate.findUniqueOrThrow({
      where: {
        scope_type_scope_id_name: { scope_type: "event", scope_id: EVENT_A, name: "ticket" },
      },
    });
    await prisma.attendee.create({
      data: {
        id: "att-multi-mail-unconfigured",
        event_id: EVENT_A,
        email: "unconfigured@example.com",
        name: "Guest",
      },
    });

    const spy = vi
      .spyOn(mailDelivery, "sendTicketEmails")
      .mockRejectedValueOnce(new Error("Cannot resolve mail provider: not set in env"));
    try {
      const res = await app.request(`/api/admin/events/${EVENT_A}/send`, {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          "Content-Type": "application/json",
          ...sameOrigin,
        },
        body: JSON.stringify({
          templateId: ticket.id,
          filter: { type: "attendee_ids", ids: ["att-multi-mail-unconfigured"] },
        }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("mail_not_configured");
    } finally {
      spy.mockRestore();
      // These two tests each spend one /send rate-limit slot on top of the rest of this
      // file's suite; reset so they don't push a later, unrelated /send test over the cap.
      rateLimitStore.reset();
    }
  });

  it("POST /send does not remap an unrelated send failure to mail_not_configured (rethrows instead)", async () => {
    await putTicketTemplate(app);
    const ticket = await prisma.mailTemplate.findUniqueOrThrow({
      where: {
        scope_type_scope_id_name: { scope_type: "event", scope_id: EVENT_A, name: "ticket" },
      },
    });
    await prisma.attendee.create({
      data: {
        id: "att-multi-mail-unrelated-error",
        event_id: EVENT_A,
        email: "unrelated-error@example.com",
        name: "Guest",
      },
    });

    const spy = vi
      .spyOn(mailDelivery, "sendTicketEmails")
      .mockRejectedValueOnce(new Error("boom: provider timed out"));
    try {
      const res = await app.request(`/api/admin/events/${EVENT_A}/send`, {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          "Content-Type": "application/json",
          ...sameOrigin,
        },
        body: JSON.stringify({
          templateId: ticket.id,
          filter: { type: "attendee_ids", ids: ["att-multi-mail-unrelated-error"] },
        }),
      });
      // Not caught by mailNotConfiguredResponse — falls through to the framework's
      // generic unhandled-error response (plain text, not our JSON error envelope).
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).not.toContain("mail_not_configured");
    } finally {
      spy.mockRestore();
      // These two tests each spend one /send rate-limit slot on top of the rest of this
      // file's suite; reset so they don't push a later, unrelated /send test over the cap.
      rateLimitStore.reset();
    }
  });

  it("POST /send dryRun attendee_ids ignores IDs from other events", async () => {
    await putTicketTemplate(app);
    const ticket = await prisma.mailTemplate.findUniqueOrThrow({
      where: {
        scope_type_scope_id_name: { scope_type: "event", scope_id: EVENT_A, name: "ticket" },
      },
    });
    await prisma.attendee.create({
      data: {
        id: "att-multi-local",
        event_id: EVENT_A,
        email: "local@example.com",
        name: "Local",
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/send`, {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({
        templateId: ticket.id,
        filter: { type: "attendee_ids", ids: ["att-multi-local", "att-foreign-other-event"] },
        dryRun: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recipientCount: number };
    expect(body.recipientCount).toBe(1);
  });

  it("POST /send rejects a ticket_type filter value not in the event's catalog (batch 04 / #351)", async () => {
    await putTicketTemplate(app);
    const ticket = await prisma.mailTemplate.findUniqueOrThrow({
      where: {
        scope_type_scope_id_name: { scope_type: "event", scope_id: EVENT_A, name: "ticket" },
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/send`, {
      method: "POST",
      headers: {
        Cookie: admin2Cookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({
        templateId: ticket.id,
        filter: { type: "ticket_type", value: "bogus-type" },
        dryRun: true,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unknown_ticket_type");
  });

  it("POST /send dryRun accepts a ticket_type filter value in the event's catalog", async () => {
    await putTicketTemplate(app);
    const ticket = await prisma.mailTemplate.findUniqueOrThrow({
      where: {
        scope_type_scope_id_name: { scope_type: "event", scope_id: EVENT_A, name: "ticket" },
      },
    });
    await prisma.attendee.create({
      data: {
        id: "att-multi-vip",
        event_id: EVENT_A,
        email: "vip@example.com",
        name: "VIP Guest",
        ticket_type: "vip",
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/send`, {
      method: "POST",
      headers: {
        Cookie: admin2Cookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({
        templateId: ticket.id,
        filter: { type: "ticket_type", value: "vip" },
        dryRun: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recipientCount: number };
    expect(body.recipientCount).toBe(1);
  });

  it("GET /send/status counts bounced and rejected as failed", async () => {
    const batchId = "batch-status-mix";
    const attendee = await prisma.attendee.create({
      data: {
        id: "att-status-mix",
        event_id: EVENT_A,
        email: "status@example.com",
        name: "Status",
      },
    });
    await prisma.emailDelivery.createMany({
      data: [
        {
          id: "del-queued",
          organization_id: ORG_A,
          event_id: EVENT_A,
          attendee_id: attendee.id,
          batch_id: batchId,
          status: "queued",
          purpose: "resend",
          provider: "export_only",
        },
        {
          id: "del-sent",
          organization_id: ORG_A,
          event_id: EVENT_A,
          attendee_id: attendee.id,
          batch_id: batchId,
          status: "sent",
          purpose: "resend",
          provider: "export_only",
        },
        {
          id: "del-bounced",
          organization_id: ORG_A,
          event_id: EVENT_A,
          attendee_id: attendee.id,
          batch_id: batchId,
          status: "bounced",
          purpose: "resend",
          provider: "export_only",
        },
        {
          id: "del-rejected",
          organization_id: ORG_A,
          event_id: EVENT_A,
          attendee_id: attendee.id,
          batch_id: batchId,
          status: "rejected",
          purpose: "resend",
          provider: "export_only",
        },
      ],
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/send/status/${batchId}`, {
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      queued: number;
      sent: number;
      failed: number;
    };
    expect(body).toEqual({ batchId, total: 4, queued: 1, sent: 1, failed: 2 });
  });

  it("POST /templates/:id/test-send sends using the selected template", async () => {
    await putTicketTemplate(app);
    const TEST_SUBJECT = "BY-ID-CUSTOM-SUBJECT-7f3a";
    const TEST_BODY =
      '<p>BY-ID-CUSTOM-BODY-MARKER-7f3a</p><p><a href="{{ticket_url}}">View ticket</a></p><img src="{{qr_image_url}}" alt="QR" />';

    const createRes = await app.request(`/api/admin/events/${EVENT_A}/templates`, {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ label: "Test send by id", template_format: "html" }),
    });
    expect(createRes.status).toBe(201);
    const { id: templateId, name: templateName } = (await createRes.json()) as {
      id: string;
      name: string;
    };

    const putRes = await app.request(
      `/api/admin/events/${EVENT_A}/templates/${templateId}`,
      {
        method: "PUT",
        headers: {
          Cookie: adminCookie,
          "Content-Type": "application/json",
          ...sameOrigin,
        },
        body: JSON.stringify({
          subject_template: TEST_SUBJECT,
          body_template: TEST_BODY,
          template_format: "html",
        }),
      },
    );
    expect(putRes.status).toBe(200);

    const ticket = await prisma.mailTemplate.findUniqueOrThrow({
      where: {
        scope_type_scope_id_name: { scope_type: "event", scope_id: EVENT_A, name: "ticket" },
      },
    });
    expect(ticket.subject_template).not.toBe(TEST_SUBJECT);

    const before = await prisma.emailDelivery.count({ where: { event_id: EVENT_A } });

    const res = await app.request(
      `/api/admin/events/${EVENT_A}/templates/${templateId}/test-send`,
      {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          "Content-Type": "application/json",
          ...sameOrigin,
        },
        body: JSON.stringify({ to: "template-by-id-test@example.com" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("sent");
    expect(exported.length).toBe(1);
    expect(exported[0]?.message.subject).toContain(TEST_SUBJECT);
    expect(exported[0]?.message.html).toContain("BY-ID-CUSTOM-BODY-MARKER-7f3a");

    const after = await prisma.emailDelivery.count({ where: { event_id: EVENT_A } });
    expect(after).toBe(before);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_A, action_type: "mail_test_sent" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as { template_id?: string; template_name?: string } | null;
    expect(meta?.template_id).toBe(templateId);
    expect(meta?.template_name).toBe(templateName);
  });

  it("POST /templates/:id/test-send returns 404 for a template from another event", async () => {
    const foreignTemplate = await ensureEventBForeignTemplate(app, prisma);

    const res = await app.request(
      `/api/admin/events/${EVENT_A}/templates/${foreignTemplate.id}/test-send`,
      {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          "Content-Type": "application/json",
          ...sameOrigin,
        },
        body: JSON.stringify({ to: "foreign-template-test@example.com" }),
      },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(exported.length).toBe(0);
  });
});
