import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword } from "@admitto/auth";
import { MAX_CONSENT_DOCUMENTS_PER_EVENT, MAX_LEGAL_CONTENT_CHARS, MAX_LEGAL_TITLE_CHARS } from "../../src/legal/legal-documents.js";
import { acquireEventLegalDocumentsLock } from "../../src/legal/registration-gate.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_A = "org-legal-docs-a";
const ORG_B = "org-legal-docs-b";
const EVENT_A = "evt-legal-docs-a";
const EVENT_A2 = "evt-legal-docs-a2";
const EVENT_B = "evt-legal-docs-b";
const EVENT_ARCHIVED = "evt-legal-docs-archived";
const EVENT_IDS = [EVENT_A, EVENT_A2, EVENT_B, EVENT_ARCHIVED];

const EMAILS = {
  adminA: "legal-docs-admin-a@example.com",
  adminB: "legal-docs-admin-b@example.com",
  operator: "legal-docs-op@example.com",
  superadmin: "legal-docs-super@example.com",
};
const PASSWORD = "legal-docs-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
const cookies = { adminA: "", adminB: "", operator: "", superadmin: "" };
const ids = { adminA: "", superadmin: "" };

async function seed(client: PrismaClient): Promise<{ adminA: string; adminB: string; operator: string; superadmin: string }> {
  await client.adminAuditLog.deleteMany({ where: { organization_id: { in: [ORG_A, ORG_B] } } });
  await client.legalDocument.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.eventRegistrationSettings.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await client.roleAssignment.deleteMany({ where: { scope_id: { in: [ORG_A, ORG_B, ...EVENT_IDS] } } });
  await client.session.deleteMany({ where: { user: { email: { in: Object.values(EMAILS) } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: Object.values(EMAILS) } } } });
  await client.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
  await client.event.deleteMany({ where: { id: { in: EVENT_IDS } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });

  const password_hash = await hashPassword(PASSWORD);
  await client.organization.createMany({
    data: [
      { id: ORG_A, name: "Legal Docs Org A", slug: "legal-docs-org-a" },
      { id: ORG_B, name: "Legal Docs Org B", slug: "legal-docs-org-b" },
    ],
  });
  await client.event.createMany({
    data: [
      { id: EVENT_A, title: "Legal Docs A", slug: "legal-docs-a", date: new Date("2026-10-01"), organization_id: ORG_A },
      { id: EVENT_A2, title: "Legal Docs A2", slug: "legal-docs-a2", date: new Date("2026-10-02"), organization_id: ORG_A },
      { id: EVENT_B, title: "Legal Docs B", slug: "legal-docs-b", date: new Date("2026-10-03"), organization_id: ORG_B },
      {
        id: EVENT_ARCHIVED,
        title: "Legal Docs Archived",
        slug: "legal-docs-archived",
        date: new Date("2026-09-01"),
        organization_id: ORG_A,
        archived_at: new Date(),
      },
    ],
  });
  const [adminA, adminB, operator, superadmin] = await Promise.all(
    [EMAILS.adminA, EMAILS.adminB, EMAILS.operator, EMAILS.superadmin].map((email) =>
      client.user.create({ data: { email, password_hash } }),
    ),
  );
  await client.roleAssignment.createMany({
    data: [
      { user_id: adminA!.id, role: "admin", scope_type: "organization", scope_id: ORG_A },
      { user_id: adminB!.id, role: "admin", scope_type: "organization", scope_id: ORG_B },
      { user_id: operator!.id, role: "operator", scope_type: "event", scope_id: EVENT_A },
      { user_id: superadmin!.id, role: "superadmin", scope_type: "instance", scope_id: null },
    ],
  });
  for (const user of [adminA!, adminB!, superadmin!]) await enrollConfirmedTotp(client, user.id);
  return { adminA: adminA!.id, adminB: adminB!.id, operator: operator!.id, superadmin: superadmin!.id };
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  const users = await seed(prisma);
  ids.adminA = users.adminA;
  ids.superadmin = users.superadmin;
  app = buildTestApp({ prisma, checkinToken: "legal-docs-checkin-token-32-chars!", adminDistRoot });
  for (const key of ["adminA", "adminB", "operator", "superadmin"] as const) {
    cookies[key] = await sessionCookieFor(prisma, users[key]);
  }
});

beforeEach(async () => {
  await prisma.legalDocument.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await prisma.eventRegistrationSettings.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: { in: [ORG_A, ORG_B] } } });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

const url = (eventId: string, ref = "") => ["/api/admin/events", eventId, "legal-documents", ref].filter(Boolean).join("/");

function serializeBody(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

function request(path: string, init: { method?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const { method = "GET", cookie = cookies.adminA, body, headers = {} } = init;
  return app.request(path, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(method === "GET" ? {} : { ...sameOrigin, "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: serializeBody(body) }),
  });
}

const save = (eventId: string, ref: string, body: unknown, cookie?: string) =>
  request(url(eventId, ref), { method: "PUT", body, ...(cookie === undefined ? {} : { cookie }) });

const TEXT = { title: "Privacy notice", content_html: "<p>We keep your data for one year.</p>" };

type Dto = {
  id: string;
  ref: string;
  kind: string;
  key: string | null;
  title: string;
  published: boolean;
  published_at: string | null;
  public_path: string;
  required: boolean;
  content_html?: string;
};

describe("who may use the routes", () => {
  const routes: [string, string, string][] = [
    ["list", "GET", url(EVENT_A)],
    ["read", "GET", url(EVENT_A, "privacy-notice")],
    ["save", "PUT", url(EVENT_A, "privacy-notice")],
    ["publish", "POST", url(EVENT_A, "privacy-notice/publish")],
    ["unpublish", "POST", url(EVENT_A, "privacy-notice/unpublish")],
    ["delete", "DELETE", url(EVENT_A, "privacy-notice")],
  ];

  it.each(routes)("%s: an unauthenticated caller gets 401", async (_name, method, path) => {
    const res = await request(path, { method, cookie: "", body: method === "PUT" ? TEXT : undefined });
    expect(res.status).toBe(401);
  });

  it.each(routes)("%s: an operator gets 403", async (_name, method, path) => {
    const res = await request(path, { method, cookie: cookies.operator, body: method === "PUT" ? TEXT : undefined });
    expect(res.status).toBe(403);
  });

  it.each(routes)("%s: an admin of another organisation gets 403 and changes nothing", async (_name, method, path) => {
    await prisma.legalDocument.create({
      data: { event_id: EVENT_A, kind: "privacy_notice", title: "Mine", content_html: "<p>Mine</p>", published_at: new Date() },
    });
    const res = await request(path, { method, cookie: cookies.adminB, body: method === "PUT" ? TEXT : undefined });
    expect(res.status).toBe(403);
    const row = await prisma.legalDocument.findFirstOrThrow({ where: { event_id: EVENT_A } });
    expect(row).toMatchObject({ title: "Mine", content_html: "<p>Mine</p>" });
    expect(row.published_at).not.toBeNull();
  });

  it("lets an admin of the organisation and a superadmin in", async () => {
    expect((await request(url(EVENT_A))).status).toBe(200);
    expect((await request(url(EVENT_A), { cookie: cookies.superadmin })).status).toBe(200);
    expect((await request(url(EVENT_B), { cookie: cookies.superadmin })).status).toBe(200);
  });

  it("answers 404 for an event that does not exist", async () => {
    expect((await request(url("evt-legal-docs-nope"), { cookie: cookies.superadmin })).status).toBe(404);
  });

  it("refuses a write sent from another site", async () => {
    const res = await request(url(EVENT_A, "privacy-notice"), {
      method: "PUT",
      body: TEXT,
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    expect(await prisma.legalDocument.count({ where: { event_id: EVENT_A } })).toBe(0);
  });

  it("does not let a text of one event be read or changed through another", async () => {
    await save(EVENT_A, "privacy-notice", TEXT);
    expect((await request(url(EVENT_A2, "privacy-notice"))).status).toBe(404);
    expect((await request(url(EVENT_A2, "privacy-notice/publish"), { method: "POST" })).status).toBe(404);
    expect((await request(url(EVENT_A2, "privacy-notice"), { method: "DELETE" })).status).toBe(404);
    expect(await prisma.legalDocument.count({ where: { event_id: EVENT_A } })).toBe(1);
    const list = (await (await request(url(EVENT_A2))).json()) as { items: Dto[] };
    expect(list.items).toEqual([]);
  });

  it("keeps every write out of an archived event", async () => {
    for (const [method, ref] of [
      ["PUT", "privacy-notice"],
      ["POST", "privacy-notice/publish"],
      ["POST", "privacy-notice/unpublish"],
      ["DELETE", "privacy-notice"],
    ] as const) {
      const res = await request(url(EVENT_ARCHIVED, ref), { method, body: method === "PUT" ? TEXT : undefined });
      expect(res.status, `${method} ${ref}`).toBe(403);
      expect(await res.json()).toEqual({ code: "event_archived" });
    }
    expect(await prisma.legalDocument.count({ where: { event_id: EVENT_ARCHIVED } })).toBe(0);
    expect((await request(url(EVENT_ARCHIVED))).status).toBe(200);
  });
});

describe("GET list", () => {
  it("is empty for a new event, which lacks the notice and the terms, and states the limits", async () => {
    const res = await request(url(EVENT_A));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [],
      missing: [
        { ref: "privacy-notice", kind: "privacy_notice", key: null },
        { ref: "event-terms", kind: "event_terms", key: null },
      ],
      limits: { title_chars: MAX_LEGAL_TITLE_CHARS, content_chars: MAX_LEGAL_CONTENT_CHARS, consents: MAX_CONSENT_DOCUMENTS_PER_EVENT },
    });
  });

  it("lists the notice, the terms, then the consents by key, without any content", async () => {
    for (const [ref, title] of [
      ["consent-photos", "Photos"],
      ["event-terms", "Terms"],
      ["consent-newsletter", "Newsletter"],
      ["privacy-notice", "Notice"],
    ] as const) {
      expect((await save(EVENT_A, ref, { title, content_html: `<p>${title}</p>` })).status).toBe(201);
    }
    const body = (await (await request(url(EVENT_A))).json()) as { items: Dto[] };
    expect(body.items.map((item) => item.ref)).toEqual(["privacy-notice", "event-terms", "consent-newsletter", "consent-photos"]);
    expect(body.items[3]).toMatchObject({
      kind: "consent",
      key: "photos",
      title: "Photos",
      published: false,
      published_at: null,
      public_path: "/legal/legal-docs-a/consent-photos",
    });
    for (const item of body.items) expect(item).not.toHaveProperty("content_html");
  });

  it("marks a consent as required only when the event asks for it, and lists the texts still unpublished", async () => {
    await save(EVENT_A, "privacy-notice", TEXT);
    await save(EVENT_A, "consent-photos", { title: "Photos", content_html: "<p>Photos</p>" });
    await request(url(EVENT_A, "privacy-notice/publish"), { method: "POST" });

    let body = (await (await request(url(EVENT_A))).json()) as { items: Dto[]; missing: unknown[] };
    expect(body.items.map((item) => [item.ref, item.required])).toEqual([
      ["privacy-notice", true],
      ["consent-photos", false],
    ]);
    expect(body.missing).toEqual([{ ref: "event-terms", kind: "event_terms", key: null }]);

    await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT_A, consent_keys: ["photos", "newsletter"] } });
    body = (await (await request(url(EVENT_A))).json()) as { items: Dto[]; missing: unknown[] };
    expect(body.items.find((item) => item.ref === "consent-photos")?.required).toBe(true);
    expect(body.missing).toEqual([
      { ref: "event-terms", kind: "event_terms", key: null },
      { ref: "consent-photos", kind: "consent", key: "photos" },
      { ref: "consent-newsletter", kind: "consent", key: "newsletter" },
    ]);
  });
});

describe("GET one", () => {
  it("returns the stored text with its content", async () => {
    await save(EVENT_A, "event-terms", { title: "Terms", content_html: "<p>Terms</p>" });
    const res = await request(url(EVENT_A, "event-terms"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ref: "event-terms",
      kind: "event_terms",
      key: null,
      title: "Terms",
      content_html: "<p>Terms</p>",
      published: false,
      required: true,
    });
  });

  it.each(["privacy_notice", "Privacy-Notice", "consent-", "consent-Bad Key", "terms", "consent-ok"])(
    "answers 404 for %j",
    async (ref) => {
      expect((await request(url(EVENT_A, encodeURIComponent(ref)))).status).toBe(404);
    },
  );
});

describe("PUT", () => {
  it("creates a text as a draft with 201, then replaces it with 200", async () => {
    const created = await save(EVENT_A, "privacy-notice", TEXT);
    expect(created.status).toBe(201);
    const first = (await created.json()) as Dto;
    expect(first).toMatchObject({ ref: "privacy-notice", title: "Privacy notice", published: false, content_html: TEXT.content_html });
    expect(first.public_path).toBe("/legal/legal-docs-a/privacy-notice");

    const replaced = await save(EVENT_A, "privacy-notice", { title: "Notice v2", content_html: "<p>New text</p>" });
    expect(replaced.status).toBe(200);
    expect(((await replaced.json()) as Dto).id).toBe(first.id);
    const rows = await prisma.legalDocument.findMany({ where: { event_id: EVENT_A } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Notice v2", content_html: "<p>New text</p>", updated_by: ids.adminA });
  });

  it("stores and returns the cleaned HTML, never what was sent", async () => {
    const res = await save(EVENT_A, "privacy-notice", {
      title: "Notice",
      content_html:
        '<h1>Title</h1><script>alert(1)</script><p onclick="x()" style="color:red">Hi <b>there</b> <a href="javascript:alert(1)">bad</a> ' +
        '<a href="https://example.com/ok">ok</a><img src=x onerror=alert(1)></p><iframe src="https://evil.example"></iframe>',
    });
    expect(res.status).toBe(201);
    const expected = '<h2>Title</h2><p>Hi <strong>there</strong> bad <a href="https://example.com/ok">ok</a></p>';
    expect(((await res.json()) as Dto).content_html).toBe(expected);
    const stored = await prisma.legalDocument.findFirstOrThrow({ where: { event_id: EVENT_A } });
    expect(stored.content_html).toBe(expected);
  });

  it.each([
    ["a script", "<p>x</p><script>alert(1)</script>"],
    ["an event handler", "<p onmouseover=alert(1)>x</p>"],
    ["a javascript link", '<a href="javascript:alert(1)">x</a>'],
    ["an entity-encoded javascript link", '<a href="&#106;avascript:alert(1)">x</a>'],
    ["an svg", "<p>x</p><svg onload=alert(1)></svg>"],
    ["a form", '<form action="https://evil.example"><input></form><p>x</p>'],
    ["a mutation payload", '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;/mglyph&gt;&lt;img&Tab;src=1&Tab;onerror=alert(1)&gt;">x'],
  ])("keeps %s out of the database", async (_name, payload) => {
    await save(EVENT_A, "privacy-notice", { title: "Notice", content_html: `<p>before</p>${payload}` });
    const stored = await prisma.legalDocument.findFirstOrThrow({ where: { event_id: EVENT_A } });
    expect(stored.content_html).not.toMatch(/<(script|svg|math|style|form|input|img|iframe)\b/i);
    expect(stored.content_html).not.toMatch(/\son\w+\s*=/i);
    expect(stored.content_html).not.toMatch(/javascript:/i);
    expect(stored.content_html).toContain("<p>before</p>");
  });

  it("refuses a text with nothing left to read, and stores nothing", async () => {
    for (const content_html of ["<script>alert(1)</script>", "<p>&nbsp;</p>", "", "   ", "<img src=x><hr>"]) {
      const res = await save(EVENT_A, "privacy-notice", { title: "Notice", content_html });
      expect(res.status, content_html).toBe(422);
      expect(await res.json()).toEqual({ error: "legal_document_empty" });
    }
    expect(await prisma.legalDocument.count({ where: { event_id: EVENT_A } })).toBe(0);
  });

  it("does not empty a published text", async () => {
    await save(EVENT_A, "privacy-notice", TEXT);
    await request(url(EVENT_A, "privacy-notice/publish"), { method: "POST" });
    const res = await save(EVENT_A, "privacy-notice", { title: "Notice", content_html: "<script>x</script>" });
    expect(res.status).toBe(422);
    const stored = await prisma.legalDocument.findFirstOrThrow({ where: { event_id: EVENT_A } });
    expect(stored.content_html).toBe(TEXT.content_html);
  });

  it("cleans the title to one line", async () => {
    const res = await save(EVENT_A, "event-terms", { title: "  Event \n\t terms\u0000 \u200b of  entry ", content_html: "<p>x</p>" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Dto).title).toBe("Event terms of entry");
  });

  it.each([
    ["no title", { content_html: "<p>x</p>" }],
    ["no content", { title: "Notice" }],
    ["an empty title", { title: "", content_html: "<p>x</p>" }],
    ["a blank title", { title: " \t\u200b ", content_html: "<p>x</p>" }],
    ["a title that is too long", { title: "t".repeat(MAX_LEGAL_TITLE_CHARS + 1), content_html: "<p>x</p>" }],
    ["content that is too long", { title: "Notice", content_html: "x".repeat(MAX_LEGAL_CONTENT_CHARS + 1) }],
    ["a field it does not know", { title: "Notice", content_html: "<p>x</p>", published: true }],
    ["a number as content", { title: "Notice", content_html: 5 }],
    ["an array", [TEXT]],
    ["null", null],
  ])("answers 400 for %s", async (_name, body) => {
    const res = await save(EVENT_A, "privacy-notice", body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "validation_failed" });
    expect(await prisma.legalDocument.count({ where: { event_id: EVENT_A } })).toBe(0);
  });

  it("accepts a title and a text at the limits", async () => {
    const res = await save(EVENT_A, "privacy-notice", {
      title: "t".repeat(MAX_LEGAL_TITLE_CHARS),
      content_html: `<p>${"x".repeat(MAX_LEGAL_CONTENT_CHARS - 7)}</p>`,
    });
    expect(res.status).toBe(201);
  });

  it("answers 400 for JSON it cannot read", async () => {
    const res = await request(url(EVENT_A, "privacy-notice"), { method: "PUT", body: "{not json" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("caps the body, so a huge request is not even read", async () => {
    const res = await request(url(EVENT_A, "privacy-notice"), {
      method: "PUT",
      body: JSON.stringify({ title: "Notice", content_html: "x".repeat(600 * 1024) }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "request too large" });
  });

  it("caps a body sent in chunks without a length too", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ title: "Notice", content_html: "x".repeat(600 * 1024) }));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const half = Math.floor(bytes.length / 2);
        controller.enqueue(bytes.slice(0, half));
        controller.enqueue(bytes.slice(half));
        controller.close();
      },
    });
    const res = await app.request(url(EVENT_A, "privacy-notice"), {
      method: "PUT",
      headers: { Cookie: cookies.adminA, ...sameOrigin, "Content-Type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "request too large" });
    expect(await prisma.legalDocument.count({ where: { event_id: EVENT_A } })).toBe(0);
  });

  it("answers 404 for a ref that names no text", async () => {
    for (const ref of ["privacy_notice", "consent-Bad", "consent-", "other"]) {
      expect((await save(EVENT_A, ref, TEXT)).status, ref).toBe(404);
    }
  });

  it("leaves publication alone: a published text stays published when edited", async () => {
    await save(EVENT_A, "privacy-notice", TEXT);
    const published = (await (await request(url(EVENT_A, "privacy-notice/publish"), { method: "POST" })).json()) as Dto;
    const edited = (await (await save(EVENT_A, "privacy-notice", { title: "Notice", content_html: "<p>Edited</p>" })).json()) as Dto;
    expect(edited.published).toBe(true);
    expect(edited.published_at).toBe(published.published_at);
  });

  it("allows only so many consents in an event, but still edits one when the limit is reached", async () => {
    for (let i = 1; i <= MAX_CONSENT_DOCUMENTS_PER_EVENT; i += 1) {
      expect((await save(EVENT_A, `consent-c${i}`, { title: `Consent ${i}`, content_html: "<p>x</p>" })).status).toBe(201);
    }
    const over = await save(EVENT_A, "consent-extra", { title: "One too many", content_html: "<p>x</p>" });
    expect(over.status).toBe(422);
    expect(await over.json()).toEqual({ error: "legal_document_limit_reached" });
    expect((await save(EVENT_A, "consent-c1", { title: "Consent 1 edited", content_html: "<p>y</p>" })).status).toBe(200);
    // The notice and the terms do not count against the consents, and another event has its own.
    expect((await save(EVENT_A, "privacy-notice", TEXT)).status).toBe(201);
    expect((await save(EVENT_A2, "consent-extra", { title: "Fine here", content_html: "<p>x</p>" })).status).toBe(201);
  });

  it("holds the limit when consents are created at the same moment", async () => {
    const results = await Promise.all(
      Array.from({ length: MAX_CONSENT_DOCUMENTS_PER_EVENT + 4 }, (_, i) =>
        save(EVENT_A, `consent-race${i}`, { title: `Race ${i}`, content_html: "<p>x</p>" }),
      ),
    );
    const statuses = results.map((res) => res.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(MAX_CONSENT_DOCUMENTS_PER_EVENT);
    expect(statuses.filter((status) => status === 422)).toHaveLength(4);
    expect(await prisma.legalDocument.count({ where: { event_id: EVENT_A, kind: "consent" } })).toBe(MAX_CONSENT_DOCUMENTS_PER_EVENT);
  });

  it("makes one text of two saves of the same ref at the same moment", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => save(EVENT_A, "event-terms", { title: `Terms ${i}`, content_html: `<p>${i}</p>` })),
    );
    expect(results.map((res) => res.status).sort()).toEqual([200, 200, 200, 200, 200, 201]);
    expect(await prisma.legalDocument.count({ where: { event_id: EVENT_A, kind: "event_terms" } })).toBe(1);
  });

  it("records who saved it and what changed, but never the text", async () => {
    await save(EVENT_A, "consent-photos", { title: "Photos", content_html: "<p>Secret wording</p>" });
    const entries = await prisma.adminAuditLog.findMany({ where: { organization_id: ORG_A } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action_type: "legal_document_saved",
      actor_user_id: ids.adminA,
      metadata: { eventId: EVENT_A, kind: "consent", key: "photos" },
    });
    expect(JSON.stringify(entries[0])).not.toContain("Secret wording");
  });
});

describe("publish and unpublish", () => {
  const post = (ref: string, action: "publish" | "unpublish", eventId = EVENT_A, cookie?: string) =>
    request(url(eventId, `${ref}/${action}`), { method: "POST", ...(cookie === undefined ? {} : { cookie }) });

  it("publishes a draft, and the date does not move when it is published again", async () => {
    await save(EVENT_A, "privacy-notice", TEXT);
    const first = await post("privacy-notice", "publish");
    expect(first.status).toBe(200);
    const body = (await first.json()) as Dto;
    expect(body).toMatchObject({ published: true, ref: "privacy-notice" });
    expect(body.published_at).not.toBeNull();
    expect(body).not.toHaveProperty("content_html");

    const again = (await (await post("privacy-notice", "publish")).json()) as Dto;
    expect(again.published_at).toBe(body.published_at);
    const published = await prisma.adminAuditLog.count({ where: { organization_id: ORG_A, action_type: "legal_document_published" } });
    expect(published).toBe(1);
  });

  it("withdraws a text, once", async () => {
    await save(EVENT_A, "event-terms", { title: "Terms", content_html: "<p>x</p>" });
    await post("event-terms", "publish");
    const res = await post("event-terms", "unpublish");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ published: false, published_at: null });
    expect((await post("event-terms", "unpublish")).status).toBe(200);
    expect(await prisma.adminAuditLog.count({ where: { organization_id: ORG_A, action_type: "legal_document_unpublished" } })).toBe(1);
    const stored = await prisma.legalDocument.findFirstOrThrow({ where: { event_id: EVENT_A } });
    expect(stored.published_at).toBeNull();
    expect(stored.content_html).toBe("<p>x</p>");
  });

  it("answers 404 for a text that does not exist", async () => {
    expect((await post("privacy-notice", "publish")).status).toBe(404);
    expect((await post("consent-photos", "unpublish")).status).toBe(404);
    expect((await post("nonsense", "publish")).status).toBe(404);
  });

  it("refuses to withdraw a text registration needs while registration is on", async () => {
    for (const [ref, title] of [
      ["privacy-notice", "Notice"],
      ["event-terms", "Terms"],
      ["consent-photos", "Photos"],
      ["consent-newsletter", "Newsletter"],
    ] as const) {
      await save(EVENT_A, ref, { title, content_html: `<p>${title}</p>` });
      await post(ref, "publish");
    }
    await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT_A, mode: "approval", consent_keys: ["photos"] } });

    for (const ref of ["privacy-notice", "event-terms", "consent-photos"]) {
      const res = await post(ref, "unpublish");
      expect(res.status, ref).toBe(409);
      expect(await res.json()).toEqual({ error: "legal_document_in_use" });
    }
    expect(await prisma.legalDocument.count({ where: { event_id: EVENT_A, published_at: null } })).toBe(0);

    // A consent the event does not ask for is not needed.
    expect((await post("consent-newsletter", "unpublish")).status).toBe(200);
  });

  it("withdraws freely while registration is off or has no mode", async () => {
    await save(EVENT_A, "privacy-notice", TEXT);
    await post("privacy-notice", "publish");
    await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT_A, mode: null } });
    expect((await post("privacy-notice", "unpublish")).status).toBe(200);
  });

  it("waits for the transaction that turns registration on, and then refuses", async () => {
    // What the screen of PR 99a does: take the lock, check the texts, save the mode.
    await save(EVENT_A, "privacy-notice", TEXT);
    await post("privacy-notice", "publish");
    await save(EVENT_A, "event-terms", { title: "Terms", content_html: "<p>x</p>" });
    await post("event-terms", "publish");

    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    let release!: () => void;
    const mayCommit = new Promise<void>((resolve) => (release = resolve));
    const turnOn = prisma.$transaction(async (tx) => {
      await acquireEventLegalDocumentsLock(tx, EVENT_A);
      await tx.eventRegistrationSettings.create({ data: { event_id: EVENT_A, mode: "automatic" } });
      locked();
      await mayCommit;
    });
    await lockTaken;

    const unpublish = Promise.resolve(post("privacy-notice", "unpublish"));
    const early = await Promise.race([unpublish.then(() => "answered"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 400))]);
    expect(early).toBe("waiting");

    release();
    await turnOn;
    const res = await unpublish;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "legal_document_in_use" });
  });
});

describe("DELETE", () => {
  it("removes a text and says so in the audit log", async () => {
    await save(EVENT_A, "consent-photos", { title: "Photos", content_html: "<p>x</p>" });
    const res = await request(url(EVENT_A, "consent-photos"), { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await prisma.legalDocument.count({ where: { event_id: EVENT_A } })).toBe(0);
    const entry = await prisma.adminAuditLog.findFirstOrThrow({ where: { organization_id: ORG_A, action_type: "legal_document_deleted" } });
    expect(entry.metadata).toEqual({ eventId: EVENT_A, kind: "consent", key: "photos" });
  });

  it("answers 404 when there is nothing to delete", async () => {
    expect((await request(url(EVENT_A, "event-terms"), { method: "DELETE" })).status).toBe(404);
  });

  it("refuses to delete a text registration needs while registration is on", async () => {
    await save(EVENT_A, "privacy-notice", TEXT);
    await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT_A, mode: "automatic" } });
    const res = await request(url(EVENT_A, "privacy-notice"), { method: "DELETE" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "legal_document_in_use" });
    expect(await prisma.legalDocument.count({ where: { event_id: EVENT_A } })).toBe(1);

    await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT_A }, data: { mode: null } });
    expect((await request(url(EVENT_A, "privacy-notice"), { method: "DELETE" })).status).toBe(200);
  });

  it("goes with the event when the event is deleted", async () => {
    await save(EVENT_A2, "privacy-notice", TEXT);
    await prisma.event.delete({ where: { id: EVENT_A2 } });
    expect(await prisma.legalDocument.count({ where: { event_id: EVENT_A2 } })).toBe(0);
    await prisma.event.create({
      data: { id: EVENT_A2, title: "Legal Docs A2", slug: "legal-docs-a2", date: new Date("2026-10-02"), organization_id: ORG_A },
    });
  });
});
