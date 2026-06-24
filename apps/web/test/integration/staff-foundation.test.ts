import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE, SETTING_BRANDING_THEME } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };
const CHECKIN_TOKEN = "staff-foundation-checkin-token-32chars!";

const ORG_A = "org-staff-foundation-a";
const ORG_B = "org-staff-foundation-b";
const EVENT_A = "evt-staff-foundation-a";
const EVENT_B = "evt-staff-foundation-b";

const EMAIL_SUPER = "staff-foundation-super@example.com";
const EMAIL_ADMIN = "staff-foundation-admin@example.com";
const EMAIL_OP = "staff-foundation-op@example.com";
const PASSWORD = "staff-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let superId: string;
let adminId: string;
let opId: string;

async function seed(client: PrismaClient) {
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: { in: [ORG_A, ORG_B, EVENT_A, EVENT_B] } }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OP] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { id: { in: [EVENT_A, EVENT_B] } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.createMany({
    data: [
      { id: ORG_A, name: "Org A", slug: "staff-foundation-a" },
      { id: ORG_B, name: "Org B", slug: "staff-foundation-b" },
    ],
  });

  await client.event.createMany({
    data: [
      {
        id: EVENT_A,
        title: "Event A",
        slug: "event-a",
        date: new Date("2026-10-01"),
        organization_id: ORG_A,
      },
      {
        id: EVENT_B,
        title: "Event B",
        slug: "event-b",
        date: new Date("2026-11-01"),
        organization_id: ORG_B,
      },
    ],
  });

  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP, password_hash } });
  superId = superUser.id;
  adminId = adminUser.id;
  opId = opUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_A },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_A },
    ],
  });

  for (const userId of [superId, adminId]) {
    await client.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }
}

beforeAll(async () => {
  prisma = new PrismaClient();
  await seed(prisma);
  app = createApp({
    prisma,
    checkinToken: CHECKIN_TOKEN,
    allowCheckinBearer: true,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

async function sessionCookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

describe("GET /api/admin/me", () => {
  it("returns profile for org admin session", async () => {
    const res = await app.request("/api/admin/me", {
      headers: { Cookie: await sessionCookieFor(adminId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { email: string };
      assignments: unknown[];
      session_active: boolean;
      mailer_status: { configured: boolean; provider: string | null };
    };
    expect(body.user.email).toBe(EMAIL_ADMIN);
    expect(body.assignments.length).toBeGreaterThan(0);
    expect(body.session_active).toBe(true);
    expect(body.mailer_status).toEqual(
      expect.objectContaining({
        configured: expect.any(Boolean),
        provider: expect.anything(),
      }),
    );
  });

  it("rejects operator session", async () => {
    const res = await app.request("/api/admin/me", {
      headers: { Cookie: await sessionCookieFor(opId) },
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/events", () => {
  it("returns 401 without session", async () => {
    const res = await app.request("/api/admin/events");
    expect(res.status).toBe(401);
  });

  it("returns 403 for operator-only", async () => {
    const res = await app.request("/api/admin/events", {
      headers: { Cookie: await sessionCookieFor(opId) },
    });
    expect(res.status).toBe(403);
  });

  it("scopes org admin to their organization", async () => {
    const res = await app.request("/api/admin/events", {
      headers: { Cookie: await sessionCookieFor(adminId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ id: string }> };
    expect(body.events.map((e) => e.id)).toEqual([EVENT_A]);
  });

  it("returns all events for superadmin including fixture events", async () => {
    const res = await app.request("/api/admin/events", {
      headers: { Cookie: await sessionCookieFor(superId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ id: string }> };
    const ids = body.events.map((e) => e.id);
    expect(ids).toContain(EVENT_A);
    expect(ids).toContain(EVENT_B);
  });

  it("excludes archived events unless includeArchived=true", async () => {
    await prisma.event.update({
      where: { id: EVENT_A },
      data: { archived_at: new Date() },
    });

    const hidden = await app.request("/api/admin/events", {
      headers: { Cookie: await sessionCookieFor(superId) },
    });
    expect(hidden.status).toBe(200);
    const hiddenBody = (await hidden.json()) as { events: Array<{ id: string }> };
    expect(hiddenBody.events.some((e) => e.id === EVENT_A)).toBe(false);

    const included = await app.request("/api/admin/events?includeArchived=true", {
      headers: { Cookie: await sessionCookieFor(superId) },
    });
    expect(included.status).toBe(200);
    const includedBody = (await included.json()) as {
      events: Array<{ id: string; archived_at: string | null }>;
    };
    const archived = includedBody.events.find((e) => e.id === EVENT_A);
    expect(archived?.archived_at).not.toBeNull();

    await prisma.event.update({
      where: { id: EVENT_A },
      data: { archived_at: null },
    });
  });
});

describe("GET /api/checkin/events", () => {
  it("returns 401 without session even with bearer", async () => {
    const res = await app.request("/api/checkin/events", {
      headers: { Authorization: `Bearer ${CHECKIN_TOKEN}` },
    });
    expect(res.status).toBe(401);
  });

  it("lists check-in events for operator", async () => {
    const res = await app.request("/api/checkin/events", {
      headers: { Cookie: await sessionCookieFor(opId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ id: string }> };
    expect(body.events.map((e) => e.id)).toEqual([EVENT_A]);
  });

  it("still lists archived event for operator (late check-in after admin archive)", async () => {
    await prisma.event.update({
      where: { id: EVENT_A },
      data: { archived_at: new Date() },
    });

    const res = await app.request("/api/checkin/events", {
      headers: { Cookie: await sessionCookieFor(opId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ id: string }> };
    expect(body.events.map((e) => e.id)).toContain(EVENT_A);

    await prisma.event.update({
      where: { id: EVENT_A },
      data: { archived_at: null },
    });
  });

  it("lists org events for org admin", async () => {
    const res = await app.request("/api/checkin/events", {
      headers: { Cookie: await sessionCookieFor(adminId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ id: string }> };
    expect(body.events.map((e) => e.id)).toEqual([EVENT_A]);
  });
});

describe("GET /api/staff/theme", () => {
  it("allows operator to read theme via session path", async () => {
    const res = await app.request("/api/staff/theme", {
      headers: { Cookie: await sessionCookieFor(opId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { theme: object; vars: Record<string, string> };
    expect(body.vars["--primary"]).toBeTruthy();
  });

  it("rejects theme mutation for operator", async () => {
    const res = await app.request("/api/staff/theme", {
      method: "PUT",
      headers: {
        Cookie: await sessionCookieFor(opId),
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ primary: "#112233" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/theme", () => {
  beforeEach(async () => {
    await prisma.systemSettings.deleteMany({
      where: { key: SETTING_BRANDING_THEME },
    });
  });

  it("allows org admin via admin API path", async () => {
    const res = await app.request("/api/admin/theme", {
      headers: { Cookie: await sessionCookieFor(adminId) },
    });
    expect(res.status).toBe(200);
  });

  it("returns default theme when no branding configured", async () => {
    const res = await app.request("/api/admin/theme", {
      headers: { Cookie: await sessionCookieFor(superId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      theme: Record<string, unknown>;
      vars: Record<string, string>;
    };
    expect(body.theme).toEqual({});
    expect(body.vars["--primary"]).toBe("#066fd1");
  });
});

describe("PUT /api/admin/theme", () => {
  beforeEach(async () => {
    await prisma.systemSettings.deleteMany({
      where: { key: SETTING_BRANDING_THEME },
    });
  });

  it("persists valid primary for superadmin", async () => {
    const res = await app.request("/api/admin/theme", {
      method: "PUT",
      headers: {
        Cookie: await sessionCookieFor(superId),
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ primary: "#aabbcc" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      theme: { primary?: string };
      vars: Record<string, string>;
    };
    expect(body.theme.primary).toBe("#aabbcc");
    expect(body.vars["--primary"]).toBe("#aabbcc");

    const getRes = await app.request("/api/admin/theme", {
      headers: { Cookie: await sessionCookieFor(superId) },
    });
    const persisted = (await getRes.json()) as { theme: { primary?: string } };
    expect(persisted.theme.primary).toBe("#aabbcc");
  });

  it("rejects org admin PUT", async () => {
    const res = await app.request("/api/admin/theme", {
      method: "PUT",
      headers: {
        Cookie: await sessionCookieFor(adminId),
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({ primary: "#112233" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects PUT without Origin header (CSRF)", async () => {
    const res = await app.request("/api/admin/theme", {
      method: "PUT",
      headers: {
        Cookie: await sessionCookieFor(superId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ primary: "#112233" }),
    });
    expect(res.status).toBe(403);
  });

  it("degrades invalid primary and non-HTTPS font URL on save", async () => {
    const res = await app.request("/api/admin/theme", {
      method: "PUT",
      headers: {
        Cookie: await sessionCookieFor(superId),
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({
        primary: "not-hex",
        font_family_url: "http://evil",
        font_family_name: "Evil",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      theme: { primary?: string; font_family_url?: string; font_family_name?: string };
      vars: Record<string, string>;
    };
    expect(body.theme.primary).toBeUndefined();
    expect(body.theme.font_family_url).toBeUndefined();
    expect(body.theme.font_family_name).toBe("Evil");
    expect(body.vars["--primary"]).toBe("#066fd1");
    expect(body.vars["--font-sans"]).toBeUndefined();

    const getRes = await app.request("/api/admin/theme", {
      headers: { Cookie: await sessionCookieFor(superId) },
    });
    const persisted = (await getRes.json()) as {
      theme: { primary?: string; font_family_url?: string; font_family_name?: string };
    };
    expect(persisted.theme.primary).toBeUndefined();
    expect(persisted.theme.font_family_url).toBeUndefined();
    expect(persisted.theme.font_family_name).toBe("Evil");
  });

  it("rejects credentialed HTTPS font URL on save", async () => {
    const res = await app.request("/api/admin/theme", {
      method: "PUT",
      headers: {
        Cookie: await sessionCookieFor(superId),
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({
        font_family_url: "https://user:pass@example.com/font.woff2",
        font_family_name: "Brand Sans",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      theme: { font_family_url?: string; font_family_name?: string };
      vars: Record<string, string>;
    };
    expect(body.theme.font_family_url).toBeUndefined();
    expect(body.theme.font_family_name).toBe("Brand Sans");
    expect(body.vars["--font-sans"]).toBeUndefined();

    const getRes = await app.request("/api/admin/theme", {
      headers: { Cookie: await sessionCookieFor(superId) },
    });
    const persisted = (await getRes.json()) as {
      theme: { font_family_url?: string; font_family_name?: string };
    };
    expect(persisted.theme.font_family_url).toBeUndefined();
    expect(persisted.theme.font_family_name).toBe("Brand Sans");
  });

  it("strips HTML from font family name on save", async () => {
    const res = await app.request("/api/admin/theme", {
      method: "PUT",
      headers: {
        Cookie: await sessionCookieFor(superId),
        "Content-Type": "application/json",
        ...sameOrigin,
      },
      body: JSON.stringify({
        font_family_url: "https://cdn.example.com/font.woff2",
        font_family_name: 'Evil</style><script>alert(1)</script>',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      theme: { font_family_url?: string; font_family_name?: string };
      vars: { fontFaceCss?: string };
    };
    expect(body.theme.font_family_name).toBe("Evilstylescriptalert1script");
    expect(body.vars.fontFaceCss).toBeDefined();
    expect(body.vars.fontFaceCss).not.toContain("</style>");
    expect(body.vars.fontFaceCss).not.toContain("<script");
  });
});

describe("staff SPA routes", () => {
  it("serves admin SPA for org admin", async () => {
    const res = await app.request("/admin", {
      headers: { Cookie: await sessionCookieFor(adminId) },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("content-security-policy")).not.toContain("https://fonts.googleapis.com");
    expect(await res.text()).toContain("staff-spa-fixture");
  });

  it("redirects operator-only away from /admin", async () => {
    const res = await app.request("/admin", {
      headers: { Cookie: await sessionCookieFor(opId) },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/operator");
  });

  it("serves operator SPA for operator", async () => {
    const res = await app.request("/operator", {
      headers: { Cookie: await sessionCookieFor(opId) },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).not.toContain("https://cdn.jsdelivr.net");
    expect(await res.text()).toContain("staff-spa-fixture");
  });

  it("serves admin SPA for superadmin on /admin/settings", async () => {
    const res = await app.request("/admin/settings", {
      headers: { Cookie: await sessionCookieFor(superId) },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("staff-spa-fixture");
  });
});