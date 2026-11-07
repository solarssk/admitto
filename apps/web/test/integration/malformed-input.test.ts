import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore, type RateLimitStore } from "../../src/rate-limit/index.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { sessionCookieFor } from "../helpers/session-cookie.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };
const json = { "Content-Type": "application/json", ...sameOrigin };

const ORG_ID = "org-malformed-input";
const EVENT_ID = "evt-malformed-input";
const EVENT_SLUG = "malformed-input-event";
const EVENT_MISSING = "evt-malformed-input-missing";
const EMAIL_SUPER = "malformed-input-super@example.com";
const EMAIL_OPERATOR = "malformed-input-operator@example.com";
const PASSWORD = "malformed-input-pass-123";

/** In-memory limiter that remembers every key it was asked to count. */
class RecordingRateLimitStore implements RateLimitStore {
  readonly keys: string[] = [];
  private readonly inner = new InMemoryRateLimitStore();
  hit(key: string, windowMs: number, max: number) {
    this.keys.push(key);
    return this.inner.hit(key, windowMs, max);
  }
  health() {
    return this.inner.health();
  }
}

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let store: RecordingRateLimitStore;
let operatorId: string;
let superCookie = "";
let operatorCookie = "";
const startedAt = new Date();

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await prisma.roleAssignment.deleteMany({ where: { user: { email: { in: [EMAIL_SUPER, EMAIL_OPERATOR] } } } });
  await prisma.session.deleteMany({ where: { user: { email: { in: [EMAIL_SUPER, EMAIL_OPERATOR] } } } });
  await prisma.userMfaMethod.deleteMany({ where: { user: { email: EMAIL_SUPER } } });
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_OPERATOR] } } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });

  await prisma.organization.create({ data: { id: ORG_ID, name: "Malformed Input Org", slug: "malformed-input-org" } });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Malformed Input Event",
      slug: EVENT_SLUG,
      date: new Date("2026-10-01"),
      organization_id: ORG_ID,
    },
  });
  const password_hash = await hashPassword(PASSWORD);
  const superUser = await prisma.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const operator = await prisma.user.create({ data: { email: EMAIL_OPERATOR, password_hash } });
  operatorId = operator.id;
  await prisma.roleAssignment.createMany({
    data: [
      { user_id: superUser.id, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: operator.id, role: "operator", scope_type: "event", scope_id: EVENT_ID },
    ],
  });
  await prisma.userMfaMethod.create({
    data: {
      user_id: superUser.id,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });

  store = new RecordingRateLimitStore();
  app = createApp({
    prisma,
    checkinToken: "malformed-input-checkin-token-32chars!",
    allowCheckinBearer: false,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: store,
    skipCheckinBootValidation: true,
    adminDistRoot,
  });
  superCookie = await sessionCookieFor(prisma, superUser.id);
  operatorCookie = await sessionCookieFor(prisma, operator.id);
});

afterAll(async () => {
  await prisma?.securityAuditLog.deleteMany({ where: { created_at: { gte: startedAt } } });
  await prisma?.$disconnect();
});

function login(email: string, password: string) {
  return app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email, password }) });
}

async function loginFailureEmails(): Promise<string[]> {
  const rows = await prisma.securityAuditLog.findMany({
    where: { event_type: "auth.login.fail", created_at: { gte: startedAt } },
    orderBy: { created_at: "asc" },
  });
  return rows.map((row) => (row.metadata as { email: string }).email);
}

describe("a request target with U+0000", () => {
  it.each([
    ["an admin path parameter", "GET", "/api/admin/events/a%00b/settings"],
    ["a path parameter of a write route", "PATCH", "/api/admin/events/a%00b/note"],
    ["the attendee search", "GET", `/api/admin/events/${EVENT_ID}/attendees?q=a%00b`],
    ["the wallet message attendee search", "GET", `/api/admin/events/${EVENT_ID}/wallet-message/attendees?q=a%00b`],
    ["the audit log search", "GET", "/api/admin/audit-log?search=a%00b"],
    ["the security audit log search", "GET", "/api/admin/security-audit-log?search=a%00b"],
    ["the user search", "GET", "/api/admin/users?q=a%00b"],
    ["the role assignment search", "GET", "/api/admin/role-assignments?q=a%00b"],
    ["the check-in stream event id", "GET", "/api/checkin/events/a%00b/stream"],
    ["the public agency ticket reference", "GET", `/t/${EVENT_SLUG}/a/%00`],
  ])("answers 400 for %s", async (_label, method, target) => {
    const res = await app.request(target, {
      method,
      headers: { ...json, Cookie: superCookie },
      ...(method === "GET" ? {} : { body: "{}" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("answers 400 for U+0000 in a path parameter, or in the query where there is none, of every registered route", async () => {
    const routes = (app as unknown as { routes: { method: string; path: string }[] }).routes;
    const targets = new Set<string>();
    for (const { method, path } of routes) {
      if (method === "ALL" || path.includes("*")) continue;
      const withParams = path.replace(/:[A-Za-z0-9_]+(\{[^}]*\})?/g, "a%00b");
      targets.add(`${method} ${withParams === path ? `${path}?q=a%00b` : withParams}`);
    }
    expect(targets.size).toBeGreaterThan(200);
    for (const target of targets) {
      const [method, path] = target.split(" ") as [string, string];
      const res = await app.request(path, {
        method,
        headers: { ...json, Cookie: superCookie },
        ...(method === "GET" ? {} : { body: "{}" }),
      });
      expect(res.status, target).toBe(400);
    }
  });

  it("does not touch a request whose escaped percent sign is merely followed by 00", async () => {
    const res = await app.request("/api/admin/events/a%2500b/settings", { headers: { Cookie: superCookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("POST /api/auth/login with an email the database cannot store", () => {
  it("treats U+0000 as an unknown account: the same 401, counted against the email limit, and recorded", async () => {
    const wrongPassword = await login(EMAIL_OPERATOR, "wrong-password-123");
    const res = await login("MalformedNul\u0000@Example.com", PASSWORD);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(await wrongPassword.json());
    expect(store.keys).toContain("auth:login:email:malformednul\u0000@example.com");
    expect(await loginFailureEmails()).toContain("malformednul\ufffd@example.com");
  });

  it("still records the failed attempt of an email with a lone surrogate", async () => {
    const res = await login("\ud800lone-surrogate@example.com", PASSWORD);
    expect(res.status).toBe(401);
    expect(await loginFailureEmails()).toContain("\ufffdlone-surrogate@example.com");
  });

  it("answers the sign-in form the same way", async () => {
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...sameOrigin },
      body: new URLSearchParams({ email: "form-nul\u0000@example.com", password: PASSWORD }).toString(),
    });
    expect(res.status).toBe(401);
    expect(await loginFailureEmails()).toContain("form-nul\ufffd@example.com");
  });
});

describe("a body value the database refuses", () => {
  it("answers 400 for a U+0000 in a body value, stores nothing, and logs a warning instead of an unhandled exception", async () => {
    resetSystemLogBufferForTest();
    const res = await app.request(`/api/admin/events/${EVENT_ID}/ticket-types`, {
      method: "POST",
      headers: { ...json, Cookie: superCookie },
      body: JSON.stringify({ label: "VIP\u0000" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(await prisma.ticketType.count({ where: { event_id: EVENT_ID, label: { startsWith: "VIP" } } })).toBe(0);
    const messages = querySystemLogs({ source: "api" }).map((entry) => entry.message);
    expect(messages).toContain("request_rejected");
    expect(messages).not.toContain("unhandled_exception");
  });
});

describe("an event that does not exist", () => {
  it.each([
    ["the template", "GET", `/api/admin/events/${EVENT_MISSING}/template`, undefined],
    ["the requirements", "GET", `/api/admin/events/${EVENT_MISSING}/items`, undefined],
    ["a pinned note save", "PATCH", `/api/admin/events/${EVENT_MISSING}/note`, { note: "x" }],
    ["a contact save", "POST", `/api/admin/events/${EVENT_MISSING}/contacts`, { name: "Venue manager" }],
    [
      "a template test send",
      "POST",
      `/api/admin/events/${EVENT_MISSING}/templates/tpl-missing/test-send`,
      { to: "someone@example.com" },
    ],
    ["a registration mail's source", "GET", `/api/admin/events/${EVENT_MISSING}/system-templates/registration-confirm`, undefined],
    [
      "a registration mail's test send",
      "POST",
      `/api/admin/events/${EVENT_MISSING}/system-templates/registration-confirm/test-send`,
      { to: "someone@example.com" },
    ],
  ])("answers 404 for %s", async (_label, method, target, body) => {
    const res = await app.request(target, {
      method,
      headers: { ...json, Cookie: superCookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("auth.access.denied for a long request path", () => {
  it("stores at most 200 characters of the path", async () => {
    const path = `/api/admin/events/${"a".repeat(3000)}/settings`;
    const res = await app.request(path, { headers: { Cookie: operatorCookie } });
    expect(res.status).toBe(403);
    const row = await prisma.securityAuditLog.findFirstOrThrow({
      where: { event_type: "auth.access.denied", user_id: operatorId, created_at: { gte: startedAt } },
      orderBy: { created_at: "desc" },
    });
    expect((row.metadata as { path: string }).path).toBe(path.slice(0, 200));
  });
});
