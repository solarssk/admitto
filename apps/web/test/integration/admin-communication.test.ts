import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
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
const ATT_A2 = "att-admin-comm-a2";
const ATT_A3 = "att-admin-comm-a3";
const ATT_A4 = "att-admin-comm-a4";

const DLV_A1_INITIAL = "dlv-admin-comm-a1-initial";
const DLV_A1_RESEND = "dlv-admin-comm-a1-resend";
const DLV_A2_TEMPLATED = "dlv-admin-comm-a2-templated";
const DLV_A3_FAILED = "dlv-admin-comm-a3-failed";
const DLV_A4_EXPIRED = "dlv-admin-comm-a4-expired";

const exported: ExportPayload[] = [];

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let adminId: string;
let opId: string;
let adminCookie = "";
let opCookie = "";
let vipTemplateId = "";

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
  await client.attendee.create({
    data: {
      id: ATT_A2,
      event_id: EVENT_A,
      email: "bob@example.com",
      name: "Bob Beta",
    },
  });
  await client.attendee.create({
    data: {
      id: ATT_A3,
      event_id: EVENT_A,
      email: "carol@example.com",
      name: "Carol Gamma",
    },
  });
  await client.attendee.create({
    data: {
      id: ATT_A4,
      event_id: EVENT_A,
      email: "dana@example.com",
      name: "Dana Delta",
    },
  });

  const vipTemplate = await client.mailTemplate.create({
    data: {
      scope_type: "event",
      scope_id: EVENT_A,
      name: "vip",
      label: "VIP invite",
      subject_template: DEFAULT_SUBJECT_TEMPLATE,
      body_template: DEFAULT_BODY_MJML,
      template_format: "mjml",
      compiled_html_template: DEFAULT_BODY_MJML,
    },
  });
  vipTemplateId = vipTemplate.id;

  await client.emailDelivery.create({
    data: {
      id: DLV_A1_INITIAL,
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
      id: DLV_A1_RESEND,
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

  // Custom-template delivery with unresolved link placeholders still literal in storage (as the
  // real send pipeline leaves them, see renderTemplateTrustedForStorage) — exercises the
  // template filter/name AND is the one row that can meaningfully prove the rendered-preview
  // route redacts a real placeholder rather than just happening to have nothing to redact.
  await client.emailDelivery.create({
    data: {
      id: DLV_A2_TEMPLATED,
      organization_id: ORG_A,
      event_id: EVENT_A,
      attendee_id: ATT_A2,
      purpose: "initial",
      template_id: vipTemplateId,
      provider: "smtp",
      provider_message_id: "msg-vip-123",
      status: "sent",
      recipient_email: "bob@example.com",
      rendered_subject: "Ticket for {{first_name}}, link: {{ticket_url}}",
      rendered_html:
        '<a href="{{ticket_url}}">Open ticket</a><img src="{{qr_image_url}}" alt="QR" width="200" height="200" />',
      sent_at: new Date("2026-09-03T12:00:00Z"),
    },
  });

  // Failed/retryable delivery with sanitized error text — exercises the new diagnostic fields
  // (provider, error, error_code, retryable, attempts) end-to-end through list/detail/export.
  await client.emailDelivery.create({
    data: {
      id: DLV_A3_FAILED,
      organization_id: ORG_A,
      event_id: EVENT_A,
      attendee_id: ATT_A3,
      purpose: "initial",
      provider: "smtp",
      status: "failed",
      error_code: "smtp_connect",
      error: "Connection refused",
      retryable: true,
      attempts: 2,
      recipient_email: "carol@example.com",
      rendered_subject: "Your ticket",
      rendered_html: "<p>secret ticket html</p>",
      failed_at: new Date("2026-09-04T12:00:00Z"),
    },
  });

  // Simulates a delivery whose stored rendered snapshot was already nulled by the retention job
  // (see retention.ts nullifyDeliverySnapshots) — the rendered-preview route must tell this apart
  // from "not found" and return an explicit null/null pair instead of empty strings.
  await client.emailDelivery.create({
    data: {
      id: DLV_A4_EXPIRED,
      organization_id: ORG_A,
      event_id: EVENT_A,
      attendee_id: ATT_A4,
      purpose: "initial",
      provider: "export_only",
      status: "sent",
      recipient_email: "dana@example.com",
      rendered_subject: null,
      rendered_html: null,
      sent_at: new Date("2026-09-05T12:00:00Z"),
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
  prisma = createTestPrismaClient();
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
  it("returns paginated event-wide log with diagnostic fields but no rendered_html", async () => {
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
    expect(body.total).toBe(5);
    expect(body.items).toHaveLength(5);
    for (const row of body.items) {
      expect(row).not.toHaveProperty("rendered_html");
      expect(row).not.toHaveProperty("token");
    }

    const failedRow = body.items.find((r) => r.id === DLV_A3_FAILED) as
      | Record<string, unknown>
      | undefined;
    expect(failedRow).toBeDefined();
    expect(failedRow).toMatchObject({
      attendee_id: ATT_A3,
      attendee_name: "Carol Gamma",
      provider: "smtp",
      provider_message_id: null,
      attempts: 2,
      retryable: true,
      status: "failed",
      error_code: "smtp_connect",
      error: "Connection refused",
      template_id: null,
      template_name: null,
    });

    const templatedRow = body.items.find((r) => r.id === DLV_A2_TEMPLATED) as
      | Record<string, unknown>
      | undefined;
    expect(templatedRow).toMatchObject({
      attendee_name: "Bob Beta",
      provider: "smtp",
      provider_message_id: "msg-vip-123",
      template_id: vipTemplateId,
      template_name: "VIP invite",
    });
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

  it("filters by search matching attendee name or email, case-insensitively", async () => {
    const byName = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries?search=anna`,
      { headers: { Cookie: adminCookie } },
    );
    expect(byName.status).toBe(200);
    const nameBody = (await byName.json()) as { items: { attendee_id: string }[]; total: number };
    expect(nameBody.total).toBe(2);
    expect(nameBody.items.every((r) => r.attendee_id === ATT_A1)).toBe(true);

    const byEmail = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries?search=${encodeURIComponent("bob@example.com")}`,
      { headers: { Cookie: adminCookie } },
    );
    expect(byEmail.status).toBe(200);
    const emailBody = (await byEmail.json()) as { items: { attendee_id: string }[]; total: number };
    expect(emailBody.total).toBe(1);
    expect(emailBody.items[0]?.attendee_id).toBe(ATT_A2);

    const noMatch = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries?search=nobody-matches-this`,
      { headers: { Cookie: adminCookie } },
    );
    const noMatchBody = (await noMatch.json()) as { total: number };
    expect(noMatchBody.total).toBe(0);
  });

  it("filters by templateId, with the \"default\" sentinel matching the built-in template", async () => {
    const custom = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries?templateId=${vipTemplateId}`,
      { headers: { Cookie: adminCookie } },
    );
    expect(custom.status).toBe(200);
    const customBody = (await custom.json()) as { items: { id: string }[]; total: number };
    expect(customBody.total).toBe(1);
    expect(customBody.items[0]?.id).toBe(DLV_A2_TEMPLATED);

    const builtin = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries?templateId=default`,
      { headers: { Cookie: adminCookie } },
    );
    expect(builtin.status).toBe(200);
    const builtinBody = (await builtin.json()) as { items: { id: string }[]; total: number };
    expect(builtinBody.items.some((r) => r.id === DLV_A2_TEMPLATED)).toBe(false);
    expect(builtinBody.total).toBeGreaterThanOrEqual(4);
  });

  it("rejects operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/deliveries`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/events/:eventId/deliveries/:deliveryId", () => {
  it("returns full detail with the attendee's timeline ordered oldest-first", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries/${DLV_A1_RESEND}`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      attendee_id: string;
      attendee_name: string;
      timeline: { id: string }[];
    };
    expect(body).not.toHaveProperty("rendered_html");
    expect(body.id).toBe(DLV_A1_RESEND);
    expect(body.attendee_id).toBe(ATT_A1);
    expect(body.attendee_name).toBe("Anna Alpha");
    expect(body.timeline.map((t) => t.id)).toEqual([DLV_A1_INITIAL, DLV_A1_RESEND]);
  });

  it("surfaces sanitized error diagnostics for a failed, retryable delivery", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries/${DLV_A3_FAILED}`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown> & { timeline: unknown[] };
    expect(body).toMatchObject({
      status: "failed",
      provider: "smtp",
      error_code: "smtp_connect",
      error: "Connection refused",
      retryable: true,
      attempts: 2,
      actor_user_id: null,
      actor_display: null,
      batch_id: null,
      session_id: null,
    });
    expect(body.timeline).toHaveLength(1);
  });

  it("returns 404 for an unknown delivery id", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries/dlv-does-not-exist`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(404);
  });

  it("rejects cross-org access before ever checking whether the delivery id exists", async () => {
    // EVENT_B belongs to ORG_B; adminCookie's admin only manages ORG_A. The access check must
    // run (and reject) before the delivery lookup, so this is 403 rather than 404 — the API must
    // not tell an unauthorized admin whether a given id exists in another org's event.
    const res = await app.request(
      `/api/admin/events/${EVENT_B}/deliveries/${DLV_A1_INITIAL}`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(403);
  });

  it("rejects operator", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries/${DLV_A1_INITIAL}`,
      { headers: { Cookie: opCookie } },
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/events/:eventId/deliveries/:deliveryId/rendered", () => {
  it("redacts the ticket link and QR image placeholders, never exposing a real URL", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries/${DLV_A2_TEMPLATED}/rendered`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subject: string | null; html: string | null };

    expect(body.subject).toBe("Ticket for {{first_name}}, link: #");
    expect(body.subject).not.toContain("{{ticket_url}}");

    expect(body.html).not.toContain("{{ticket_url}}");
    expect(body.html).not.toContain("{{qr_image_url}}");
    expect(body.html).toContain('href="#"');
    expect(body.html).toContain("data:image/svg+xml");
    expect(body.html).not.toContain("http://");
    expect(body.html).not.toContain("https://");
  });

  it("returns null subject/html once the retention window has nulled the stored snapshot", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries/${DLV_A4_EXPIRED}/rendered`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subject: string | null; html: string | null };
    expect(body).toEqual({ subject: null, html: null });
  });

  it("returns 404 for an unknown delivery id", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries/dlv-does-not-exist/rendered`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(404);
  });

  it("rejects operator", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries/${DLV_A2_TEMPLATED}/rendered`,
      { headers: { Cookie: opCookie } },
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/events/:eventId/deliveries/export", () => {
  it("exports the filtered delivery log as CSV with the new diagnostic columns", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries/export?format=csv&status=failed`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain('filename="delivery-log-');

    const text = await res.text();
    const lines = text.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toContain('"Provider"');
    expect(lines[0]).toContain('"Attempts"');
    expect(lines[0]).toContain('"Retryable"');
    expect(lines[0]).toContain('"Error code"');
    expect(lines[0]).toContain('"Error"');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Carol Gamma"');
    expect(lines[1]).toContain('"smtp_connect"');
    expect(lines[1]).toContain('"Connection refused"');
    expect(lines[1]).toContain('"yes"');
  });

  it("rejects a missing format", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_A}/deliveries/export`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(400);
  });

  it("rejects operator", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/deliveries/export?format=csv`,
      { headers: { Cookie: opCookie } },
    );
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
