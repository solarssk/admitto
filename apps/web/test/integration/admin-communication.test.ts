import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE, setSetting, SETTING_INSTANCE_URL } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { setMailSettings } from "@admitto/mailer-config";
import {
  DEFAULT_BODY_MJML,
  DEFAULT_SUBJECT_TEMPLATE,
  MjmlCompileError,
  PlaceholderInHtmlCommentError,
  UnknownPlaceholdersError,
  UnquotedAttributePlaceholderError,
} from "@admitto/mail-templates";
import type { ExportPayload } from "@admitto/mailer";
import { createApp } from "../../src/app.js";
import { MAX_TEMPLATE_BODY_BYTES, MAX_TEMPLATE_TEST_SEND_BODY_BYTES } from "../../src/admin/communication-api-routes.js";
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

  await client.emailDelivery.create({
    data: {
      organization_id: ORG_A,
      event_id: EVENT_A,
      attendee_id: ATT_A1,
      purpose: "resend",
      provider: "export_only",
      status: "sent",
      recipient_email: "anna@example.com",
      rendered_subject: "Your ticket (resend)",
      rendered_html: "<p>secret resend html</p>",
      sent_at: new Date("2026-09-02T12:00:00Z"),
    },
  });
}

async function sessionCookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

function createMailAppWithoutInjectedBaseUrl(): ReturnType<typeof createApp> {
  const prevNode = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    return createApp({
      prisma,
      checkinToken: "admin-comm-checkin-token-32chars!!",
      allowCheckinBearer: true,
      rateLimitStore: createRateLimitStore(),
      skipCheckinBootValidation: true,
      adminDistRoot,
      mailDeliveryDeps: { exportSink: (p) => { exported.push(p); } },
    });
  } finally {
    process.env.NODE_ENV = prevNode;
  }
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
      image_placeholders: string[];
    };
    expect(body.source).toBe("builtin");
    expect(body.body_template).toContain("mjml");
    expect(body.allowed_placeholders).toContain("ticket_url");
    expect(body.image_placeholders).toEqual(
      expect.arrayContaining(["logo_url", "header_image_url", "qr_image_url"]),
    );
    expect(body.image_placeholders).not.toContain("ticket_url");
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
      where: {
        scope_type_scope_id_name: { scope_type: "event", scope_id: EVENT_A, name: "ticket" },
      },
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

  it("rejects body larger than schema char limit", async () => {
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

  it("rejects JSON body larger than wire byte cap", async () => {
    const oversizeChars = MAX_TEMPLATE_BODY_BYTES;
    const res = await app.request(`/api/admin/events/${EVENT_A}/template`, {
      method: "PUT",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        subject_template: "Subject",
        body_template: "x".repeat(oversizeChars),
        template_format: "html",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("template too large");
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

  it("rejects body larger than schema char limit", async () => {
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

  it("rejects JSON body larger than wire byte cap", async () => {
    const oversizeChars = MAX_TEMPLATE_BODY_BYTES;
    const res = await app.request(`/api/admin/events/${EVENT_A}/template/preview`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validTemplate,
        body_template: "x".repeat(oversizeChars),
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("template too large");
  });

  it("absolutizes uploaded logo using DB instance_url when BASE_URL env is unset", async () => {
    const logoPath = "/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png";
    const instanceUrl = "https://tickets-from-db.example.com";
    const prevBase = process.env.BASE_URL;
    delete process.env.BASE_URL;

    await prisma.organization.update({
      where: { id: ORG_A },
      data: { logo_url: logoPath },
    });
    await setSetting(prisma, SETTING_INSTANCE_URL, instanceUrl);

    const logoTemplate = {
      subject_template: "Logo preview {{event_name}}",
      body_template:
        '<p><img src="{{logo_url}}" alt="Logo" width="120" height="40" /></p>' +
        '<p><a href="{{ticket_url}}">Ticket</a></p>' +
        '<p><img src="{{qr_image_url}}" alt="QR" width="80" height="80" /></p>',
      template_format: "html" as const,
    };

    try {
      const dbOnlyApp = createMailAppWithoutInjectedBaseUrl();
      const res = await dbOnlyApp.request(`/api/admin/events/${EVENT_A}/template/preview`, {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify(logoTemplate),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { html: string };
      expect(body.html).toContain(`${instanceUrl}${logoPath}`);
    } finally {
      if (prevBase === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = prevBase;
      await Promise.allSettled([
        prisma.systemSettings.deleteMany({ where: { key: SETTING_INSTANCE_URL } }),
        prisma.organization.update({ where: { id: ORG_A }, data: { logo_url: null } }),
      ]);
    }
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
    expect(exported).toHaveLength(1);

    const after = await prisma.emailDelivery.count({ where: { event_id: EVENT_A } });
    expect(after).toBe(before);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_A, action_type: "mail_test_sent" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as { to?: string } | null;
    expect(meta?.to).toBeUndefined();
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

  it("rejects oversized JSON body", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/template/test-send`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: `${"x".repeat(MAX_TEMPLATE_TEST_SEND_BODY_BYTES)}@example.com` }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("request too large");
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

  it("filters by purpose", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries?purpose=resend`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { purpose: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.items.every((r) => r.purpose === "resend")).toBe(true);
  });

  it("returns 400 for invalid purpose filter", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries?purpose=not-a-purpose`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(400);
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

describe("POST /api/admin/events/:eventId/templates", () => {
  async function clearEventTemplates(): Promise<void> {
    await prisma.mailTemplate.deleteMany({
      where: { scope_type: "event", scope_id: EVENT_A },
    });
  }

  it("creates a separately named event template", async () => {
    await clearEventTemplates();
    try {
      const res = await app.request(`/api/admin/events/${EVENT_A}/templates`, {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Reminder", ...validTemplate }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { name: string; label: string; compiled_html_template: string };
      expect(body.name).toBe("reminder");
      expect(body.label).toBe("Reminder");
      expect(body.compiled_html_template).toContain("html");
    } finally {
      await clearEventTemplates();
    }
  });

  it("enforces the template cap inside concurrent create transactions", async () => {
    await clearEventTemplates();
    try {
      for (let i = 1; i <= 9; i++) {
        const res = await app.request(`/api/admin/events/${EVENT_A}/templates`, {
          method: "POST",
          headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
          body: JSON.stringify({ label: `Reminder ${i}`, ...validTemplate }),
        });
        expect(res.status).toBe(201);
      }

      const create = (label: string) =>
        app.request(`/api/admin/events/${EVENT_A}/templates`, {
          method: "POST",
          headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
          body: JSON.stringify({ label, ...validTemplate }),
        });
      const [first, second] = await Promise.all([create("Concurrent one"), create("Concurrent two")]);

      expect([first.status, second.status].sort()).toEqual([201, 422]);
      const limitResponse = first.status === 422 ? first : second;
      expect(await limitResponse.json()).toMatchObject({ error: "template_limit_reached", limit: 10 });
      expect(
        await prisma.mailTemplate.count({ where: { scope_type: "event", scope_id: EVENT_A } }),
      ).toBe(10);
    } finally {
      await clearEventTemplates();
    }
  });

  it("retries unique conflicts before returning a client-safe conflict response", async () => {
    await clearEventTemplates();
    const transaction = vi.spyOn(prisma, "$transaction").mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate template", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    try {
      const res = await app.request(`/api/admin/events/${EVENT_A}/templates`, {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Conflict", ...validTemplate }),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "template_name_conflict" });
      expect(transaction).toHaveBeenCalledTimes(5);
    } finally {
      transaction.mockRestore();
      await clearEventTemplates();
    }
  });

  it.each([
    [
      "MJML compilation errors",
      () => new MjmlCompileError([{ message: "Invalid MJML" }]),
      { error: "template_validation_failed", errors: ["Invalid MJML"] },
    ],
    [
      "unknown placeholders",
      () => new UnknownPlaceholdersError(["not_a_placeholder"]),
      { error: "template_validation_failed", errors: ["Unknown placeholder: not_a_placeholder"] },
    ],
    [
      "placeholders inside HTML comments",
      () => new PlaceholderInHtmlCommentError(["event_name"]),
      { error: "template_validation_failed", errors: ["Placeholder in HTML comment: event_name"] },
    ],
    [
      "unquoted placeholder attributes",
      () => new UnquotedAttributePlaceholderError(["href"]),
      { error: "template_validation_failed", errors: ["Unquoted attribute placeholder: href"] },
    ],
  ])("maps %s thrown inside the create transaction", async (_label, createError, expected) => {
    await clearEventTemplates();
    const transaction = vi.spyOn(prisma, "$transaction").mockRejectedValue(createError());

    try {
      const res = await app.request(`/api/admin/events/${EVENT_A}/templates`, {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Mapped failure", ...validTemplate }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(expected);
    } finally {
      transaction.mockRestore();
      await clearEventTemplates();
    }
  });

  it("does not disguise an unexpected transaction failure as a validation response", async () => {
    await clearEventTemplates();
    const transaction = vi.spyOn(prisma, "$transaction").mockRejectedValue(new Error("database unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const res = await app.request(`/api/admin/events/${EVENT_A}/templates`, {
        method: "POST",
        headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Unexpected failure", ...validTemplate }),
      });
      expect(res.status).toBe(500);
    } finally {
      consoleError.mockRestore();
      transaction.mockRestore();
      await clearEventTemplates();
    }
  });
});
