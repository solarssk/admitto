import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG = "org-api-cache";
const EVENT = "event-api-cache";
const USER_SUPER = "user-api-cache-super";
const USER_OPERATOR = "user-api-cache-operator";
const USER_LEAVING = "user-api-cache-leaving";
const USERS = [USER_SUPER, USER_OPERATOR, USER_LEAVING];

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let superCookie = "";
let operatorCookie = "";
let leavingCookie = "";

async function seed(client: PrismaClient) {
  await client.session.deleteMany({ where: { user_id: { in: USERS } } });
  await client.userMfaMethod.deleteMany({ where: { user_id: { in: USERS } } });
  await client.roleAssignment.deleteMany({ where: { user_id: { in: USERS } } });
  await client.user.deleteMany({ where: { id: { in: USERS } } });
  await client.event.deleteMany({ where: { id: EVENT } });
  await client.organization.deleteMany({ where: { id: ORG } });

  const password_hash = await hashPassword("api-cache-pass-123");
  await client.organization.create({ data: { id: ORG, name: "Cache Org", slug: "cache-org" } });
  await client.event.create({
    data: {
      id: EVENT,
      title: "Cache Event",
      slug: "cache-event",
      date: new Date("2026-09-01"),
      organization_id: ORG,
    },
  });
  for (const id of USERS) {
    await client.user.create({ data: { id, email: `${id}@example.com`, password_hash } });
    await client.userMfaMethod.create({
      data: {
        user_id: id,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }
  await client.roleAssignment.create({
    data: { user_id: USER_SUPER, role: "superadmin", scope_type: "instance", scope_id: null },
  });
  await client.roleAssignment.create({
    data: { user_id: USER_OPERATOR, role: "operator", scope_type: "event", scope_id: EVENT },
  });
  await client.roleAssignment.create({
    data: { user_id: USER_LEAVING, role: "operator", scope_type: "event", scope_id: EVENT },
  });
}

async function cookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seed(prisma);
  app = createApp({
    prisma,
    baseUrl: "https://admitto.example.com",
    rateLimitStore: new InMemoryRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
    mailDeliveryDeps: { exportSink: () => {} },
  });
  superCookie = await cookieFor(USER_SUPER);
  operatorCookie = await cookieFor(USER_OPERATOR);
  leavingCookie = await cookieFor(USER_LEAVING);
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("Cache-Control on real staff answers", () => {
  // Answers a superadmin reads. None of these routes sets a Cache-Control of its own.
  const superAdminRoutes = [
    "/api/auth/me",
    "/api/admin/me",
    "/api/admin/users",
    "/api/admin/audit-log",
    "/api/admin/security-audit-log",
    "/api/admin/system-logs",
    "/api/admin/role-assignments",
    "/api/admin/system-settings",
    "/api/admin/identity/providers",
    "/api/account",
    "/api/account/sessions",
    "/api/admin/events",
    `/api/admin/events/${EVENT}/settings`,
  ];

  it.each(superAdminRoutes)("GET %s answers with no-store", async (path) => {
    const res = await app.request(path, { headers: { Cookie: superCookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  // What a check-in tablet reads: attendee names and counts, on a shared device.
  const operatorRoutes = [
    "/api/checkin/events",
    `/api/checkin/history?eventId=${EVENT}`,
    `/api/checkin/stats?eventId=${EVENT}`,
    `/api/checkin/ticket-types?eventId=${EVENT}`,
    `/api/checkin/ops-config?eventId=${EVENT}`,
  ];

  it.each(operatorRoutes)("GET %s answers an operator with no-store", async (path) => {
    const res = await app.request(path, { headers: { Cookie: operatorCookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers a failed request with no-store as well", async () => {
    const unknownProvider = await app.request("/api/admin/identity/providers/does-not-exist", {
      headers: { Cookie: superCookie },
    });
    expect(unknownProvider.status).toBe(404);
    expect(unknownProvider.headers.get("Cache-Control")).toBe("no-store");

    const signedOut = await app.request("/api/admin/users");
    expect(signedOut.status).toBe(401);
    expect(signedOut.headers.get("Cache-Control")).toBe("no-store");

    const forbidden = await app.request("/api/admin/users", { headers: { Cookie: operatorCookie } });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers a POST with no-store too", async () => {
    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: leavingCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("leaves the live check-in stream with its own no-cache", async () => {
    const res = await app.request(`/api/checkin/events/${EVENT}/stream`, {
      headers: { Cookie: operatorCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    await res.body?.cancel();
  });

  it("keeps the no-store a handler sets for an export download", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/export-pii`, {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("Cache-Control on every /api route", () => {
  // The only /api answer that sets a different value of its own. A new route that has to be cached
  // sets its own Cache-Control and is added here on purpose; every other route gets no-store.
  const ownCacheControl = new Map([["GET /api/checkin/events/:eventId/stream", "no-cache"]]);

  function concretePath(pattern: string, eventId: string): string {
    return pattern.replace(":eventId", eventId).replaceAll(/:[A-Za-z]+/g, "does-not-exist");
  }

  /** Every concrete /api route Hono has registered, once per method and path (middleware, whose
   * method is ALL, is not a route). */
  function registeredApiRoutes(): Array<{ method: string; pattern: string }> {
    const seen = new Set<string>();
    const routes: Array<{ method: string; pattern: string }> = [];
    for (const route of app.routes) {
      if (route.method === "ALL" || !route.path.startsWith("/api")) continue;
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({ method: route.method, pattern: route.path });
    }
    return routes;
  }

  it("is no-store on all of them, except the one that sets its own", async () => {
    const routes = registeredApiRoutes();
    // A router change must not turn this into a loop over nothing.
    expect(routes.length, "registered /api routes").toBeGreaterThan(200);

    const wrong: string[] = [];
    for (const { method, pattern } of routes) {
      // GET reads with a real superadmin session. Everything else goes without a session and
      // against an event that does not exist, so a handler can only refuse it.
      const isRead = method === "GET";
      const res = await app.request(concretePath(pattern, isRead ? EVENT : "does-not-exist"), {
        method,
        headers: isRead ? { Cookie: superCookie } : {},
      });
      if (res.headers.get("Content-Type")?.includes("text/event-stream")) await res.body?.cancel();
      else await res.arrayBuffer();

      const expected = ownCacheControl.get(`${method} ${pattern}`) ?? "no-store";
      const actual = res.headers.get("Cache-Control");
      if (actual !== expected) wrong.push(`${method} ${pattern}: ${actual ?? "no header"}`);
    }
    expect(wrong).toEqual([]);
  }, 120_000);
});
