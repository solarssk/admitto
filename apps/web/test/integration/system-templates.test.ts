import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { SYSTEM_TEMPLATE_NAMES } from "@admitto/mail-templates";
import { createApp } from "../../src/app.js";
import { countEventActivitySignals, isEventDeletable } from "../../src/admin/event-deletion.js";
import { createRateLimitStore, type InMemoryRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG = "org-sys-tpl";
const EVENT = "evt-sys-tpl";
const EMAIL_ADMIN = "sys-tpl-admin@example.com";
const PASSWORD = "sys-tpl-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let adminCookie = "";

/** A registration-* row inserted straight into the table, the way a restore or a later PR would:
 * no route involved, so nothing but the read paths can keep it out of the way. */
async function insertSystemRow(name: string, body = "{{first_name}}") {
  return prisma.mailTemplate.create({
    data: {
      scope_type: "event",
      scope_id: EVENT,
      name,
      label: name,
      subject_template: "Subject {{event_name}}",
      body_template: body,
      template_format: "html",
      compiled_html_template: `<p>${body}</p>`,
    },
  });
}

function api(path: string, init: { method?: string; body?: unknown } = {}) {
  return app.request(`/api/admin/events/${EVENT}${path}`, {
    method: init.method ?? "GET",
    headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

describe("system (registration-*) mail templates", () => {
  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await prisma.organization.create({ data: { id: ORG, name: "Org", slug: "sys-tpl-org" } });
    await prisma.event.create({
      data: {
        id: EVENT,
        title: "Event",
        slug: "sys-tpl-event",
        date: new Date("2026-10-01"),
        organization_id: ORG,
      },
    });
    const user = await prisma.user.create({
      data: { email: EMAIL_ADMIN, password_hash: await hashPassword(PASSWORD) },
    });
    await prisma.roleAssignment.create({
      data: { user_id: user.id, role: "admin", scope_type: "organization", scope_id: ORG },
    });
    await prisma.userMfaMethod.create({
      data: {
        user_id: user.id,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
    const { rawToken } = await createSession(prisma, { userId: user.id, stage: SESSION_STAGE.FULL });
    adminCookie = `admitto_session=${rawToken}`;
    app = createApp({
      prisma,
      checkinToken: "sys-tpl-checkin-token-32-chars!!!",
      allowCheckinBearer: true,
      baseUrl: "https://tickets.example.com",
      rateLimitStore: createRateLimitStore() as InMemoryRateLimitStore,
      skipCheckinBootValidation: true,
      adminDistRoot,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.mailTemplate.deleteMany({ where: { scope_id: EVENT } });
    await prisma.attendee.deleteMany({ where: { event_id: EVENT } });
  });

  it("flags system rows in the list and leaves ticket and free templates unflagged", async () => {
    await insertSystemRow("registration-received");
    await insertSystemRow("ticket");
    await insertSystemRow("reminder");

    const res = await api("/templates");
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: { name: string; is_system: boolean }[] };
    expect(Object.fromEntries(items.map((i) => [i.name, i.is_system]))).toEqual({
      "registration-received": true,
      ticket: false,
      reminder: false,
    });
  });

  it("does not count system rows toward the ten-template cap (create and the pre-check)", async () => {
    for (const name of SYSTEM_TEMPLATE_NAMES) await insertSystemRow(name);
    for (let i = 1; i <= 10; i++) {
      const res = await api("/templates", {
        method: "POST",
        body: { label: `Free ${i}`, template_format: "mjml" },
      });
      expect(res.status).toBe(201);
    }
    const eleventh = await api("/templates", {
      method: "POST",
      body: { label: "Free 11", template_format: "mjml" },
    });
    expect(eleventh.status).toBe(422);
    expect(await eleventh.json()).toMatchObject({ error: "template_limit_reached", limit: 10 });
  });

  it("refuses a bulk send with a system template, even when the id is sent directly", async () => {
    const row = await insertSystemRow("registration-rejected");
    await prisma.attendee.create({
      data: { id: "att-sys-tpl", event_id: EVENT, email: "guest@example.com", name: "Guest" },
    });
    for (const dryRun of [true, false]) {
      const res = await api("/send", {
        method: "POST",
        body: {
          templateId: row.id,
          filter: { type: "attendee_ids", ids: ["att-sys-tpl"] },
          dryRun,
        },
      });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "system_template_not_sendable" });
    }
    expect(await prisma.emailDelivery.count({ where: { event_id: EVENT } })).toBe(0);
  });

  it("still lets a free template be bulk sent (dry run)", async () => {
    const row = await insertSystemRow("reminder");
    await prisma.attendee.create({
      data: { id: "att-sys-tpl-2", event_id: EVENT, email: "guest2@example.com", name: "Guest" },
    });
    const res = await api("/send", {
      method: "POST",
      body: { templateId: row.id, filter: { type: "attendee_ids", ids: ["att-sys-tpl-2"] }, dryRun: true },
    });
    expect(res.status).toBe(200);
  });

  it("does not let system rows block permanent event deletion, but a free template still does", async () => {
    for (const name of [...SYSTEM_TEMPLATE_NAMES, "ticket"]) await insertSystemRow(name);
    const event = { archived_at: null, pinned_note: null };
    expect(isEventDeletable(event, await countEventActivitySignals(prisma, EVENT))).toBe(true);

    await insertSystemRow("reminder");
    expect(isEventDeletable(event, await countEventActivitySignals(prisma, EVENT))).toBe(false);
  });

  describe.each(["ticket_url", "qr_image_url", "apple_wallet_url", "google_wallet_url", "download_page_url"])(
    "saving a registration-* template with {{%s}}",
    (placeholder) => {
      it("is refused on save and on preview, as an unknown placeholder", async () => {
        const row = await insertSystemRow("registration-received");
        const body = { body_template: `<p>Hi {{first_name}} <a href="{{${placeholder}}}">x</a></p>`, template_format: "html" };

        const put = await api(`/templates/${row.id}`, { method: "PUT", body });
        expect(put.status).toBe(400);
        expect(await put.json()).toEqual({
          error: "template_validation_failed",
          errors: [`Unknown placeholder: ${placeholder}`],
        });

        const preview = await api(`/templates/${row.id}/preview`, { method: "POST", body });
        expect(preview.status).toBe(400);
        const stored = await prisma.mailTemplate.findUniqueOrThrow({ where: { id: row.id } });
        expect(stored.body_template).toBe("{{first_name}}");
      });
    },
  );

  it("accepts confirm_url and the contact placeholders on a registration-* template", async () => {
    const row = await insertSystemRow("registration-confirm");
    const res = await api(`/templates/${row.id}`, {
      method: "PUT",
      body: {
        subject_template: "Confirm {{event_name}}",
        body_template:
          '<p>Hi {{first_name}}, <a href="{{confirm_url}}">confirm</a>. Ask {{contact_name}} ({{contact_email}}).</p>',
        template_format: "html",
      },
    });
    expect(res.status).toBe(200);
  });

  it("refuses the registration-only placeholders on a new free-form template at preflight", async () => {
    const res = await api("/templates", {
      method: "POST",
      body: {
        label: "Free with contact",
        template_format: "html",
        subject_template: "Hello",
        body_template: "<p>{{contact_line}} {{confirm_url}}</p>",
      },
    });
    expect(res.status).toBe(400);
  });

  it("keeps requiring ticket_url on the ticket template and still allows it there", async () => {
    const row = await insertSystemRow("ticket");
    const without = await api(`/templates/${row.id}`, {
      method: "PUT",
      body: { body_template: "<p>No links</p>", template_format: "html" },
    });
    expect(without.status).toBe(400);
    const withLinks = await api(`/templates/${row.id}`, {
      method: "PUT",
      body: {
        body_template: '<a href="{{ticket_url}}"><img src="{{qr_image_url}}" alt="QR"></a>',
        template_format: "html",
      },
    });
    expect(withLinks.status).toBe(200);
  });
});
