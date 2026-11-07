import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { setMailSettings } from "@admitto/mailer-config";
import type { ExportPayload } from "@admitto/mailer";
import { SYSTEM_TEMPLATE_NAMES, getBuiltinTemplateSource, resolveTemplateForEvent } from "@admitto/mail-templates";
import { sessionCookieFor } from "../helpers/session-cookie.js";
import { createApp } from "../../src/app.js";
import { countEventActivitySignals, isEventDeletable } from "../../src/admin/event-deletion.js";
import { createRateLimitStore, type InMemoryRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG = "org-sys-tpl";
const EVENT = "evt-sys-tpl";
const ORG_OTHER = "org-sys-tpl-other";
const EVENT_OTHER = "evt-sys-tpl-other";
const EMAIL_ADMIN = "sys-tpl-admin@example.com";
const EMAIL_OPERATOR = "sys-tpl-operator@example.com";
const PASSWORD = "sys-tpl-pass-123";

const exported: ExportPayload[] = [];

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let adminCookie = "";
let operatorCookie = "";

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

function api(path: string, init: { method?: string; body?: unknown; cookie?: string; eventId?: string } = {}) {
  return app.request(`/api/admin/events/${init.eventId ?? EVENT}${path}`, {
    method: init.method ?? "GET",
    headers: { Cookie: init.cookie ?? adminCookie, "Content-Type": "application/json", ...sameOrigin },
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
    // A second organization the admin has no role in, and an operator of the first event.
    await prisma.organization.create({ data: { id: ORG_OTHER, name: "Other org", slug: "sys-tpl-other-org" } });
    await prisma.event.create({
      data: {
        id: EVENT_OTHER,
        title: "Other event",
        slug: "sys-tpl-other-event",
        date: new Date("2026-10-01"),
        organization_id: ORG_OTHER,
      },
    });
    const operator = await prisma.user.create({
      data: { email: EMAIL_OPERATOR, password_hash: await hashPassword(PASSWORD) },
    });
    await prisma.roleAssignment.create({
      data: { user_id: operator.id, role: "operator", scope_type: "event", scope_id: EVENT },
    });
    operatorCookie = await sessionCookieFor(prisma, operator.id);
    await setMailSettings(
      { scopeType: "organization", scopeId: ORG },
      { provider: "export_only", fromAddress: "events@example.com" },
      prisma,
    );
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
      mailDeliveryDeps: {
        exportSink: (payload) => {
          exported.push(payload);
        },
      },
    });
  });

  afterAll(async () => {
    // Everything this file made: global tables outlive it in the worker's schema, and the next file starts there.
    await prisma.attendeeActionLog.deleteMany({ where: { event_id: { in: [EVENT, EVENT_OTHER] } } });
    await prisma.mailTemplate.deleteMany({ where: { scope_id: { in: [EVENT, EVENT_OTHER, ORG, ORG_OTHER] } } });
    await prisma.mailSettings.deleteMany({ where: { scope_id: ORG } });
    await prisma.roleAssignment.deleteMany({ where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_OPERATOR] } } } });
    await prisma.session.deleteMany({ where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_OPERATOR] } } } });
    await prisma.userMfaMethod.deleteMany({ where: { user: { email: EMAIL_ADMIN } } });
    await prisma.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN, EMAIL_OPERATOR] } } });
    await prisma.event.deleteMany({ where: { id: { in: [EVENT, EVENT_OTHER] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [ORG, ORG_OTHER] } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.mailTemplate.deleteMany({ where: { scope_id: { in: [EVENT, ORG] } } });
    await prisma.attendee.deleteMany({ where: { event_id: EVENT } });
    await prisma.attendeeActionLog.deleteMany({ where: { event_id: EVENT } });
    await prisma.eventContact.deleteMany({ where: { event_id: EVENT } });
    exported.length = 0;
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

  it("refuses {{ticket_type}} on a registration-* template too: a guest has no ticket type yet, so it would render blank", async () => {
    const row = await insertSystemRow("registration-received");
    const body = { body_template: "<p>Hi {{first_name}}, your {{ticket_type}} place</p>", template_format: "html" };

    const put = await api(`/templates/${row.id}`, { method: "PUT", body });
    expect(put.status).toBe(400);
    expect(await put.json()).toEqual({ error: "template_validation_failed", errors: ["Unknown placeholder: ticket_type"] });

    const preview = await api(`/templates/${row.id}/preview`, { method: "POST", body });
    expect(preview.status).toBe(400);
  });

  it("refuses a registration-confirm template without its link, on save and on preview: the mail would be of no use", async () => {
    const confirm = await insertSystemRow("registration-confirm");
    const body = { body_template: "<p>Hi {{first_name}}, please confirm your address.</p>", template_format: "html" };

    const put = await api(`/templates/${confirm.id}`, { method: "PUT", body });
    expect(put.status).toBe(400);
    expect(await put.json()).toEqual({
      error: "template_validation_failed",
      errors: ["Missing required placeholder: confirm_url"],
    });
    expect((await api(`/templates/${confirm.id}/preview`, { method: "POST", body })).status).toBe(400);
    const stored = await prisma.mailTemplate.findUniqueOrThrow({ where: { id: confirm.id } });
    expect(stored.body_template).toBe("{{first_name}}");

    // The other registration mails carry no link to confirm, so they are not asked for one.
    const received = await insertSystemRow("registration-received");
    expect((await api(`/templates/${received.id}`, { method: "PUT", body })).status).toBe(200);
  });

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

  describe("the by-name routes of the registration mails (/system-templates/:name)", () => {
    const CONFIRM_BODY = '<p>Hello, <a href="{{confirm_url}}">confirm</a> for {{event_name}}.</p>';
    const draft = (body: string, subject = "About {{event_name}}") => ({
      subject_template: subject,
      body_template: body,
      template_format: "html",
    });
    const rowOf = (name: string, scope = EVENT, scopeType = "event") =>
      prisma.mailTemplate.findUnique({
        where: { scope_type_scope_id_name: { scope_type: scopeType, scope_id: scope, name } },
      });

    describe("GET", () => {
      it.each([...SYSTEM_TEMPLATE_NAMES])("opens %s with its built-in default when the event has no row, and creates none", async (name) => {
        const res = await api(`/system-templates/${name}`);
        expect(res.status).toBe(200);
        const builtin = getBuiltinTemplateSource(name);
        expect(await res.json()).toEqual({
          subject_template: builtin.subject,
          body_template: builtin.body,
          template_format: "mjml",
          source: "builtin",
        });
        expect(await prisma.mailTemplate.count({ where: { scope_id: { in: [EVENT, ORG] } } })).toBe(0);
      });

      it("opens the event's own text before the organization's, and the organization's before the built-in default", async () => {
        const name = "registration-waitlist";
        await prisma.mailTemplate.create({
          data: {
            scope_type: "organization",
            scope_id: ORG,
            name,
            label: name,
            subject_template: "Org subject",
            body_template: "<p>Org body</p>",
            template_format: "html",
            compiled_html_template: "<p>Org body</p>",
          },
        });
        expect(await (await api(`/system-templates/${name}`)).json()).toMatchObject({
          source: "organization",
          subject_template: "Org subject",
          body_template: "<p>Org body</p>",
          template_format: "html",
        });

        await insertSystemRow(name, "Event body");
        expect(await (await api(`/system-templates/${name}`)).json()).toMatchObject({
          source: "event",
          subject_template: "Subject {{event_name}}",
          body_template: "Event body",
        });
      });

      it.each(["ticket", "reminder", "registration_confirm", "constructor", "__proto__"])(
        "answers 404 for %s, which is not a registration mail, on the routes that read, save and preview",
        async (name) => {
          for (const [method, path, body] of [
            ["GET", `/system-templates/${name}`, undefined],
            ["PUT", `/system-templates/${name}`, draft("<p>x</p>")],
            ["POST", `/system-templates/${name}/preview`, draft("<p>x</p>")],
          ] as const) {
            const res = await api(path, { method, body });
            expect(res.status, `${method} ${path}`).toBe(404);
            expect(await res.json()).toEqual({ error: "not_found" });
          }
          expect(await prisma.mailTemplate.count({ where: { scope_id: EVENT } })).toBe(0);
        },
      );

      // One request only: the test-send budget is five a minute for this admin and event, and the tests of the
      // route itself, further down, need it.
      it("answers 404 on the test-send route too, for the ticket template, which has its own", async () => {
        const res = await api("/system-templates/ticket/test-send", { method: "POST", body: { to: "someone@example.com" } });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "not_found" });
        expect(exported).toHaveLength(0);
      });

      it("refuses a write, a preview and a test send that come from another site, with nothing saved or sent", async () => {
        const crossSite = { ...sameOrigin, Origin: "https://evil.example" };
        for (const [method, path, body] of [
          ["PUT", "/system-templates/registration-confirm", draft(CONFIRM_BODY)],
          ["POST", "/system-templates/registration-confirm/preview", draft(CONFIRM_BODY)],
          ["POST", "/system-templates/registration-confirm/test-send", { to: "someone@example.com" }],
        ] as const) {
          const res = await app.request(`/api/admin/events/${EVENT}${path}`, {
            method,
            headers: { Cookie: adminCookie, "Content-Type": "application/json", ...crossSite },
            body: JSON.stringify(body),
          });
          expect(res.status, `${method} ${path}`).toBe(403);
        }
        expect(await prisma.mailTemplate.count({ where: { scope_id: EVENT } })).toBe(0);
        expect(exported).toHaveLength(0);
      });

      it("answers someone who may not manage the event with 403 whatever the name, so the routes tell nothing about which names exist", async () => {
        for (const name of ["registration-confirm", "ticket", "no-such-mail"]) {
          const res = await api(`/system-templates/${name}`, { cookie: operatorCookie });
          expect(res.status, name).toBe(403);
        }
      });

      it("refuses an operator and an admin of another organization on all four routes", async () => {
        for (const [method, path, body] of [
          ["GET", "/system-templates/registration-confirm", undefined],
          ["PUT", "/system-templates/registration-confirm", draft(CONFIRM_BODY)],
          ["POST", "/system-templates/registration-confirm/preview", draft(CONFIRM_BODY)],
          ["POST", "/system-templates/registration-confirm/test-send", { to: "someone@example.com" }],
        ] as const) {
          const asOperator = await api(path, { method, body, cookie: operatorCookie });
          expect(asOperator.status, `operator ${method} ${path}`).toBe(403);
          const otherEvent = await api(path, { method, body, eventId: EVENT_OTHER });
          expect(otherEvent.status, `other organization ${method} ${path}`).toBe(403);
        }
        expect(await prisma.mailTemplate.count({ where: { scope_id: { in: [EVENT, EVENT_OTHER] } } })).toBe(0);
      });
    });

    describe("PUT", () => {
      it("creates the event's row on the first save, with the built-in label, and updates that row on the next", async () => {
        const first = await api("/system-templates/registration-confirm", {
          method: "PUT",
          body: draft(CONFIRM_BODY, "Please confirm {{event_name}}"),
        });
        expect(first.status).toBe(200);
        const created = (await first.json()) as Record<string, unknown>;
        expect(created).toMatchObject({
          name: "registration-confirm",
          label: "Registration: confirm email",
          icon: null,
          description: null,
          template_format: "html",
          subject_template: "Please confirm {{event_name}}",
          body_template: CONFIRM_BODY,
          is_system: true,
        });
        expect(typeof created["id"]).toBe("string");
        expect(await prisma.mailTemplate.count({ where: { scope_id: EVENT } })).toBe(1);

        const second = await api("/system-templates/registration-confirm", {
          method: "PUT",
          body: draft(`${CONFIRM_BODY}<p>Thanks</p>`),
        });
        expect(second.status).toBe(200);
        expect(((await second.json()) as { id: string }).id).toBe(created["id"]);
        const rows = await prisma.mailTemplate.findMany({ where: { scope_id: EVENT } });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.body_template).toBe(`${CONFIRM_BODY}<p>Thanks</p>`);
        expect(rows[0]?.compiled_html_template).toContain("Thanks");
      });

      it("makes the registration mail use the saved text from then on (the worker resolves it by name), and the organization's before that", async () => {
        const event = { id: EVENT, organization_id: ORG };
        expect((await resolveTemplateForEvent(event, prisma, "registration-received")).source).toBe("builtin");

        const res = await api("/system-templates/registration-received", {
          method: "PUT",
          body: draft("<p>We have your registration for {{event_name}}.</p>", "Got it: {{event_name}}"),
        });
        expect(res.status).toBe(200);
        const resolved = await resolveTemplateForEvent(event, prisma, "registration-received");
        expect(resolved.source).toBe("event");
        expect(resolved.subjectTemplate).toBe("Got it: {{event_name}}");
        expect(resolved.compiledHtmlTemplate).toContain("We have your registration");
      });

      it("records the save by the name of the mail and its format, with no text of the mail", async () => {
        await api("/system-templates/registration-rejected", {
          method: "PUT",
          body: draft("<p>Secret wording {{event_name}}</p>"),
        });
        const log = await prisma.attendeeActionLog.findFirstOrThrow({
          where: { event_id: EVENT, action_type: "mail_template_updated" },
        });
        expect(log.attendee_id).toBeNull();
        expect(log.metadata).toEqual({ template_name: "registration-rejected", format: "html" });
      });

      it.each([
        ["{{ticket_url}} in any registration mail", "registration-received", '<p><a href="{{ticket_url}}">t</a></p>', ["Unknown placeholder: ticket_url"]],
        ["{{ticket_type}} in any registration mail", "registration-waitlist", "<p>{{ticket_type}}</p>", ["Unknown placeholder: ticket_type"]],
        ["{{confirm_url}} outside registration-confirm", "registration-rejected", '<p><a href="{{confirm_url}}">c</a></p>', ["Unknown placeholder: confirm_url"]],
        ["no {{confirm_url}} in registration-confirm", "registration-confirm", "<p>Please confirm</p>", ["Missing required placeholder: confirm_url"]],
        ["an unknown placeholder", "registration-received", "<p>{{nope}}</p>", ["Unknown placeholder: nope"]],
      ])("refuses %s with 400 and saves nothing", async (_label, name, body, errors) => {
        const res = await api(`/system-templates/${name}`, { method: "PUT", body: draft(body) });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "template_validation_failed", errors });
        expect(await prisma.mailTemplate.count({ where: { scope_id: EVENT } })).toBe(0);
        expect(await prisma.attendeeActionLog.count({ where: { event_id: EVENT } })).toBe(0);
      });

      it("accepts the contact placeholders in any registration mail", async () => {
        const res = await api("/system-templates/registration-waitlist", {
          method: "PUT",
          body: draft("<p>{{contact_line}} {{contact_name}} {{contact_email}}</p>"),
        });
        expect(res.status).toBe(200);
      });

      it.each([
        ["a body that is not an object", "[]"],
        ["a field the route does not know (a label to set)", JSON.stringify({ ...draft("<p>x</p>"), label: "Mine" })],
        ["no subject", JSON.stringify({ body_template: "<p>x</p>", template_format: "html" })],
        ["a format that does not exist", JSON.stringify({ ...draft("<p>x</p>"), template_format: "docx" })],
        ["text that is not JSON", "{not json"],
      ])("answers 400 validation_failed for %s", async (_label, raw) => {
        const res = await app.request(`/api/admin/events/${EVENT}/system-templates/registration-received`, {
          method: "PUT",
          headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
          body: raw,
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "validation_failed" });
        expect(await prisma.mailTemplate.count({ where: { scope_id: EVENT } })).toBe(0);
      });
    });

    describe("preview", () => {
      it("renders a draft with the sample confirmation link and saves nothing", async () => {
        const res = await api("/system-templates/registration-confirm/preview", {
          method: "POST",
          body: draft(CONFIRM_BODY, "Confirm {{event_name}}"),
        });
        expect(res.status).toBe(200);
        const { subject, html } = (await res.json()) as { subject: string; html: string };
        expect(subject).toBe("Confirm Event");
        expect(html).toContain("/confirm/sample-id.sample-mac");
        expect(html).not.toContain("{{");
        expect(await prisma.mailTemplate.count({ where: { scope_id: EVENT } })).toBe(0);
      });

      it("shows the event's own contact in place of the sample one, and no contact line when the event has none", async () => {
        const preview = async () =>
          ((await (await api("/system-templates/registration-received/preview", {
            method: "POST",
            body: draft("<p>{{contact_line}}|{{contact_name}}|{{contact_email}}</p>"),
          })).json()) as { html: string }).html;

        const without = await preview();
        expect(without).not.toContain("Sample Organizer");
        expect(without).not.toContain("organizer@example.com");

        await prisma.eventContact.create({ data: { event_id: EVENT, name: "Ann Organizer", email: "ann@example.com" } });
        const withContact = await preview();
        expect(withContact).toContain("Questions? Contact Ann Organizer at ann@example.com.|Ann Organizer|ann@example.com");
      });

      it("refuses what a save would refuse, as 400 with the same errors", async () => {
        const ticket = await api("/system-templates/registration-waitlist/preview", {
          method: "POST",
          body: draft('<p><a href="{{ticket_url}}">t</a></p>'),
        });
        expect(ticket.status).toBe(400);
        expect(await ticket.json()).toEqual({
          error: "template_validation_failed",
          errors: ["Unknown placeholder: ticket_url"],
        });
        const noLink = await api("/system-templates/registration-confirm/preview", {
          method: "POST",
          body: draft("<p>no link</p>"),
        });
        expect(noLink.status).toBe(400);
        expect(await noLink.json()).toEqual({
          error: "template_validation_failed",
          errors: ["Missing required placeholder: confirm_url"],
        });
      });

      it("refuses markup that cannot be compiled instead of failing with a server error", async () => {
        const res = await api("/system-templates/registration-received/preview", {
          method: "POST",
          body: {
            subject_template: "S",
            body_template: "<mjml><mj-body><mj-nope></mj-nope></mj-body></mjml>",
            template_format: "mjml",
          },
        });
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toBe("template_validation_failed");
      });
    });

    describe("test send", () => {
      it("sends the built-in default of a mail with no row to the address, records it by name and creates no delivery", async () => {
        const res = await api("/system-templates/registration-confirm/test-send", {
          method: "POST",
          body: { to: "tester@example.com" },
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: "sent" });
        expect(exported).toHaveLength(1);
        expect(exported[0]?.message.to).toBe("tester@example.com");
        expect(exported[0]?.message.subject).toBe("Confirm your email for Event");
        expect(await prisma.emailDelivery.count({ where: { event_id: EVENT } })).toBe(0);
        const log = await prisma.attendeeActionLog.findFirstOrThrow({
          where: { event_id: EVENT, action_type: "mail_test_sent" },
        });
        expect(log.metadata).toEqual({ template_name: "registration-confirm" });
      });

      it("sends the text the event saved when it has saved one", async () => {
        await api("/system-templates/registration-waitlist", {
          method: "PUT",
          body: draft("<p>Waiting list wording</p>", "Wait for {{event_name}}"),
        });
        exported.length = 0;
        const res = await api("/system-templates/registration-waitlist/test-send", {
          method: "POST",
          body: { to: "tester2@example.com" },
        });
        expect(res.status).toBe(200);
        expect(exported[0]?.message.subject).toBe("Wait for Event");
        expect(exported[0]?.message.html).toContain("Waiting list wording");
      });

      it("refuses an address that is not valid", async () => {
        const res = await api("/system-templates/registration-confirm/test-send", {
          method: "POST",
          body: { to: "not-an-email" },
        });
        expect(res.status).toBe(400);
        expect(exported).toHaveLength(0);
      });
    });

    describe("reverting by deleting the row, and the lock on the identity of a registration mail", () => {
      it("sends the mail back to the built-in default and records the revert by the name of the mail", async () => {
        const row = await insertSystemRow("registration-received", "<p>Custom</p>");
        const res = await api(`/templates/${row.id}`, { method: "DELETE" });
        expect(res.status).toBe(200);
        expect(await rowOf("registration-received")).toBeNull();

        const after = await (await api("/system-templates/registration-received")).json();
        expect(after).toMatchObject({ source: "builtin", subject_template: getBuiltinTemplateSource("registration-received").subject });
        const log = await prisma.attendeeActionLog.findFirstOrThrow({
          where: { event_id: EVENT, action_type: "mail_template_reverted" },
        });
        expect(log.metadata).toEqual({ template_name: "registration-received" });
      });

      it("falls back to the organization's text, not the built-in default, when the organization has one", async () => {
        await prisma.mailTemplate.create({
          data: {
            scope_type: "organization",
            scope_id: ORG,
            name: "registration-waitlist",
            label: "org",
            subject_template: "Org waitlist",
            body_template: "<p>Org</p>",
            template_format: "html",
            compiled_html_template: "<p>Org</p>",
          },
        });
        const row = await insertSystemRow("registration-waitlist");
        expect((await api(`/templates/${row.id}`, { method: "DELETE" })).status).toBe(200);
        expect(await (await api("/system-templates/registration-waitlist")).json()).toMatchObject({
          source: "organization",
          subject_template: "Org waitlist",
        });
      });

      it("still refuses to delete the ticket template, and records no revert for a free template that is deleted", async () => {
        const ticket = await insertSystemRow("ticket");
        const refused = await api(`/templates/${ticket.id}`, { method: "DELETE" });
        expect(refused.status).toBe(422);
        expect(await refused.json()).toEqual({ error: "template_required" });
        expect(await rowOf("ticket")).not.toBeNull();

        const free = await insertSystemRow("reminder");
        expect((await api(`/templates/${free.id}`, { method: "DELETE" })).status).toBe(200);
        expect(await prisma.attendeeActionLog.count({ where: { event_id: EVENT, action_type: "mail_template_reverted" } })).toBe(0);
      });

      it("refuses to rename or re-icon a registration mail, and keeps its label through a content save that sends one", async () => {
        const row = await insertSystemRow("registration-rejected");
        const patch = await api(`/templates/${row.id}`, { method: "PATCH", body: { label: "Mine", icon: "star" } });
        expect(patch.status).toBe(422);
        expect(await patch.json()).toEqual({ error: "system_template_locked" });

        const put = await api(`/templates/${row.id}`, {
          method: "PUT",
          body: { ...draft("<p>Changed {{event_name}}</p>"), label: "Mine" },
        });
        expect(put.status).toBe(200);
        const stored = await prisma.mailTemplate.findUniqueOrThrow({ where: { id: row.id } });
        expect(stored.label).toBe("registration-rejected");
        expect(stored.icon).toBeNull();
        expect(stored.body_template).toContain("Changed");
      });

      it("still renames a free template by PATCH and by PUT", async () => {
        const row = await insertSystemRow("reminder");
        const patch = await api(`/templates/${row.id}`, { method: "PATCH", body: { label: "Reminder mail" } });
        expect(patch.status).toBe(200);
        const put = await api(`/templates/${row.id}`, {
          method: "PUT",
          body: { ...draft("<p>Hi {{first_name}}</p>"), label: "Reminder again" },
        });
        expect(put.status).toBe(200);
        expect((await prisma.mailTemplate.findUniqueOrThrow({ where: { id: row.id } })).label).toBe("Reminder again");
      });
    });
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
