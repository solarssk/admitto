import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { setMailSettings } from "@admitto/mailer-config";
import {
  DEFAULT_BODY_MJML,
  DEFAULT_SUBJECT_TEMPLATE,
} from "@admitto/mail-templates";
import type { ExportPayload } from "@admitto/mailer";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_A = "org-admin-comm-a";
const ORG_B = "org-admin-comm-b";
const EVENT_A = "evt-admin-comm-a";
const EVENT_B = "evt-admin-comm-b";

const EMAIL_ADMIN = "admin-comm-admin@example.com";
const EMAIL_OP = "admin-comm-op@example.com";
const PASSWORD = "admin-comm-pass-123";

const ATT_A1 = "att-admin-comm-a1";

const exported: ExportPayload[] = [];

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let adminId: string;
let opId: string;
let adminCookie = "";
let opCookie = "";

const validTemplate = {
  subject_template: DEFAULT_SUBJECT_TEMPLATE,
  body_template: DEFAULT_BODY_MJML,
  template_format: "mjml" as const,
};

async function seed(client: PrismaClient) {
  await client.attendeeActionLog.deleteMany({
    where: { event_id: { in: [EVENT_A, EVENT_B] } },
  });
  await client.emailDelivery.deleteMany({
    where: { event_id: { in: [EVENT_A, EVENT_B] } },
  });
  await client.mailTemplate.deleteMany({
    where: { scope_id: { in: [EVENT_A, EVENT_B, ORG_A, ORG_B] } },
  });
  await client.attendee.deleteMany({ where: { event_id: { in: [EVENT_A, EVENT_B] } } });
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: { in: [ORG_A, ORG_B, EVENT_A, EVENT_B] } }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { id: { in: [EVENT_A, EVENT_B] } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.createMany({
    data: [
      { id: ORG_A, name: "Org A", slug: "admin-comm-a" },
      { id: ORG_B, name: "Org B", slug: "admin-comm-b" },
    ],
  });

  await client.event.createMany({
    data: [
      {
        id: EVENT_A,
        title: "Event A",
        slug: "event-admin-comm-a",
        date: new Date("2026-10-01"),
        organization_id: ORG_A,
      },
      {
        id: EVENT_B,
        title: "Event B",
        slug: "event-admin-comm-b",
        date: new Date("2026-11-01"),
        organization_id: ORG_B,
      },
    ],
  });

  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP, password_hash } });
  adminId = adminUser.id;
  opId = opUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_A },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_A },
    ],
  });

  await client.userMfaMethod.create({
    data: {
      user_id: adminId,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });

  await setMailSettings(
    { scopeType: "organization", scopeId: ORG_A },
    { provider: "export_only", fromAddress: "events@example.com" },
    client,
  );

  await client.attendee.create({
    data: {
      id: ATT_A1,
      event_id: EVENT_A,
      email: "anna@example.com",
      name: "Anna Alpha",
    },
  });

  await client.emailDelivery.create({
    data: {
      organization_id: ORG_A,
      event_id: EVENT_A,
      attendee_id: ATT_A1,
      purpose: "initial",
      provider: "export_only",
      status: "sent",
      recipient_email: "anna@example.com",
      rendered_subject: "Your ticket",
      rendered_html: "<p>secret ticket html</p>",
      sent_at: new Date("2026-09-01T12:00:00Z"),
    },
  });
}

async function sessionCookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  await seed(prisma);
  exported.length = 0;
  app = createApp({
    prisma,
    checkinToken: "admin-comm-checkin-token-32chars!!",
    allowCheckinBearer: true,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
    mailDeliveryDeps: { exportSink: (p) => { exported.push(p); } },
  });
  adminCookie = await sessionCookieFor(adminId);
  opCookie = await sessionCookieFor(opId);
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("GET /api/admin/events/:eventId/template", () => {
  it("returns builtin template when event has no override", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/template`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      body_template: string;
      allowed_placeholders: string[];
    };
    expect(body.source).toBe("builtin");
    expect(body.body_template).toContain("mjml");
    expect(body.allowed_placeholders).toContain("ticket_url");
  });

  it("rejects operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/template`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });

  it("rejects cross-event admin without access", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_B}/template`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("PUT /api/admin/events/:eventId/template", () => {
  it("saves and compiles event-scoped template", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/template`, {
      method: "PUT",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify(validTemplate),
    });
    expect(res.status).toBe(200);

    const row = await prisma.mailTemplate.findUnique({
      where: { scope_type_scope_id: { scope_type: "event", scope_id: EVENT_A } },
    });
    expect(row).not.toBeNull();
    expect(row!.compiled_html_template.length).toBeGreaterThan(0);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_A, action_type: "mail_template_updated" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
  });

  it("rejects unknown placeholder", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/template`, {
      method: "PUT",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validTemplate,
        subject_template: "Hi {{not_a_real_placeholder}}",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors.some((e) => e.includes("not_a_real_placeholder"))).toBe(true);
  });

  it("rejects missing required URL placeholders", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/template`, {
      method: "PUT",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        subject_template: "Ticket for {{event_name}}",
        body_template: "<p>Hi {{first_name}}</p>",
        template_format: "html",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors.some((e) => e.includes("ticket_url"))).toBe(true);
    expect(body.errors.some((e) => e.includes("qr_image_url"))).toBe(true);
  });

  it("rejects body larger than limit", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/template`, {
      method: "PUT",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        subject_template: "Subject",
        body_template: "x".repeat(260_000),
        template_format: "html",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/template`, {
      method: "PUT",
      headers: { Cookie: opCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify(validTemplate),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/events/:eventId/template/preview", () => {
  it("returns subject and html for valid draft", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/template/preview`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify(validTemplate),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subject: string; html: string };
    expect(body.subject).toContain("Event A");
    expect(body.html.length).toBeGreaterThan(0);
  });

  it("rejects invalid MJML", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/template/preview`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validTemplate,
        body_template: "<mjml><mj-body><mj-broken /></mj-body></mjml>",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it("rejects body larger than limit", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/template/preview`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validTemplate,
        body_template: "x".repeat(260_000),
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/template/preview`, {
      method: "POST",
      headers: { Cookie: opCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify(validTemplate),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/events/:eventId/template/test-send", () => {
  it("sends test mail, audits, and does not create attendee delivery", async () => {
    await app.request(`/api/admin/events/${EVENT_A}/template`, {
      method: "PUT",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify(validTemplate),
    });

    const before = await prisma.emailDelivery.count({ where: { event_id: EVENT_A } });
    exported.length = 0;

    const res = await app.request(`/api/admin/events/${EVENT_A}/template/test-send`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("sent");
    expect(exported.length).toBe(1);

    const after = await prisma.emailDelivery.count({ where: { event_id: EVENT_A } });
    expect(after).toBe(before);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_A, action_type: "mail_test_sent" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as { to?: string };
    expect(meta.to).toBe("tester@example.com");
  });

  it("rejects invalid email", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/template/test-send`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/template/test-send`, {
      method: "POST",
      headers: { Cookie: opCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/events/:eventId/deliveries", () => {
  it("returns paginated event-wide log without rendered_html", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries?page=1&pageSize=10`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Record<string, unknown>[];
      total: number;
      page: number;
      pageSize: number;
    };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    for (const row of body.items) {
      expect(row).not.toHaveProperty("rendered_html");
      expect(row).not.toHaveProperty("token");
    }
  });

  it("filters by status", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries?status=sent`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { status: string }[] };
    expect(body.items.every((r) => r.status === "sent")).toBe(true);
  });

  it("returns 400 for invalid status filter", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries?status=not-a-status`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(400);
  });

  it("rejects operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/deliveries`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });
});
