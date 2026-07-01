import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { DEFAULT_BODY_MJML, DEFAULT_SUBJECT_TEMPLATE } from "@admitto/mail-templates";
import type { ExportPayload } from "@admitto/mailer";
import { setMailSettings } from "@admitto/mailer-config";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_A = "org-multi-tpl-a";
const EVENT_A = "evt-multi-tpl-a";
const EVENT_B = "evt-multi-tpl-b";
const EMAIL_ADMIN = "multi-tpl-admin@example.com";
const PASSWORD = "multi-tpl-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let adminCookie = "";
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
  await client.session.deleteMany({ where: { user: { email: EMAIL_ADMIN } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: EMAIL_ADMIN } } });
  await client.user.deleteMany({ where: { email: EMAIL_ADMIN } });
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
      rateLimitStore: createRateLimitStore(),
      skipCheckinBootValidation: true,
      adminDistRoot,
      mailDeliveryDeps: { exportSink: (p) => exported.push(p) },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
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
    await prisma.event.create({
      data: {
        id: EVENT_B,
        title: "Event B",
        slug: "multi-tpl-event-b",
        date: new Date("2026-11-01"),
        organization_id: ORG_A,
      },
    });

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
    const reminder = await prisma.mailTemplate.findUniqueOrThrow({
      where: {
        scope_type_scope_id_name: { scope_type: "event", scope_id: EVENT_A, name: "reminder" },
      },
    });
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/templates/${reminder.id}`,
      {
        method: "DELETE",
        headers: { Cookie: adminCookie, ...sameOrigin },
      },
    );
    expect(res.status).toBe(200);
  });

  it("DELETE blocks reminder template when deliveries exist", async () => {
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
    await prisma.emailDelivery.create({
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

    const res = await app.request(
      `/api/admin/events/${EVENT_A}/templates/${reminder.id}`,
      {
        method: "DELETE",
        headers: { Cookie: adminCookie, ...sameOrigin },
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("template_in_use");
  });

  it("DELETE blocks custom template when deliveries exist", async () => {
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
    await prisma.emailDelivery.create({
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

    const res = await app.request(
      `/api/admin/events/${EVENT_A}/templates/${custom.id}`,
      {
        method: "DELETE",
        headers: { Cookie: adminCookie, ...sameOrigin },
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("template_in_use");
  });

  it("POST /send dryRun returns recipientCount", async () => {
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

  it("POST /send dryRun attendee_ids ignores IDs from other events", async () => {
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
    const ticket = await prisma.mailTemplate.findUniqueOrThrow({
      where: {
        scope_type_scope_id_name: { scope_type: "event", scope_id: EVENT_A, name: "ticket" },
      },
    });

    const before = await prisma.emailDelivery.count({ where: { event_id: EVENT_A } });
    exported.length = 0;

    const res = await app.request(
      `/api/admin/events/${EVENT_A}/templates/${ticket.id}/test-send`,
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

    const after = await prisma.emailDelivery.count({ where: { event_id: EVENT_A } });
    expect(after).toBe(before);
  });
});
