import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, resolveInstanceOrganizationId } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { decryptFromString, encryptToString, SECRET_CONTEXTS } from "@admitto/crypto";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";
import { ACCESS_METHODS_SETTINGS_KEY } from "../../src/registration/access-methods.js";
import { verifyBotChallenge, botChallengeCData } from "../../src/registration/bot-challenge.js";
import { TURNSTILE_SETTINGS_KEY } from "../../src/registration/turnstile-settings.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };
const jsonHeaders = { "Content-Type": "application/json", ...sameOrigin };

const ORG_ID = "org-reg-settings";
const EVENT_ID = "evt-reg-settings";
const EVENT_SLUG = "reg-settings-event";
const IDP_ISSUER = "https://idp.reg-settings.example.com";
const PASSWORD = "reg-settings-pass-123";
const EMAILS = {
  superadmin: "reg-settings-super@example.com",
  admin: "reg-settings-admin@example.com",
  operator: "reg-settings-operator@example.com",
};
const SITE_KEY = "0x4AAAAAAAregSettingsSite";
const SECRET = "0x4AAAAAAAregSettingsSecretValue";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let superCookie = "";
let adminCookie = "";
let operatorCookie = "";

const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
  { method: "GET", path: "/api/admin/registration/turnstile" },
  { method: "PUT", path: "/api/admin/registration/turnstile", body: { site_key: SITE_KEY } },
  { method: "DELETE", path: "/api/admin/registration/turnstile" },
  { method: "GET", path: "/api/admin/registration/access-methods" },
  { method: "PUT", path: "/api/admin/registration/access-methods", body: { methods: ["link"] } },
];

function call(route: (typeof ROUTES)[number], cookie?: string, extra: Record<string, string> = {}) {
  return app.request(route.path, {
    method: route.method,
    headers: { ...(route.body === undefined ? sameOrigin : jsonHeaders), ...(cookie ? { Cookie: cookie } : {}), ...extra },
    ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) }),
  });
}

function put(path: string, body: unknown, cookie = superCookie) {
  return app.request(path, { method: "PUT", headers: { ...jsonHeaders, Cookie: cookie }, body: JSON.stringify(body) });
}

async function storedValue(key: string): Promise<string | null> {
  return (await prisma.systemSettings.findUnique({ where: { key } }))?.value_json ?? null;
}

async function cleanSettings() {
  await prisma.systemSettings.deleteMany({ where: { key: { in: [TURNSTILE_SETTINGS_KEY, ACCESS_METHODS_SETTINGS_KEY] } } });
}

async function auditRows() {
  return prisma.adminAuditLog.findMany({
    where: { action_type: { startsWith: "registration_" } },
    orderBy: { created_at: "asc" },
  });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  const emails = Object.values(EMAILS);
  await prisma.roleAssignment.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.userMfaMethod.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.eventRegistrationSettings.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.identityProvider.deleteMany({ where: { issuer: IDP_ISSUER } });
  await prisma.adminAuditLog.deleteMany({ where: { action_type: { startsWith: "registration_" } } });
  await cleanSettings();

  await prisma.organization.create({ data: { id: ORG_ID, name: "Reg Settings Org", slug: "reg-settings-org" } });
  await prisma.event.create({
    data: { id: EVENT_ID, title: "Reg Settings Event", slug: EVENT_SLUG, date: new Date("2026-12-01"), organization_id: ORG_ID },
  });

  const password_hash = await hashPassword(PASSWORD);
  const [superUser, adminUser, operatorUser] = await Promise.all(
    [EMAILS.superadmin, EMAILS.admin, EMAILS.operator].map((email) => prisma.user.create({ data: { email, password_hash } })),
  );
  await prisma.roleAssignment.createMany({
    data: [
      { user_id: superUser!.id, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: adminUser!.id, role: "admin", scope_type: "organization", scope_id: ORG_ID },
      { user_id: operatorUser!.id, role: "operator", scope_type: "event", scope_id: EVENT_ID },
    ],
  });
  for (const user of [superUser!, adminUser!, operatorUser!]) {
    await prisma.userMfaMethod.create({
      data: { user_id: user.id, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
    });
  }

  app = createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: new InMemoryRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
  });
  superCookie = await sessionCookieFor(prisma, superUser!.id);
  adminCookie = await sessionCookieFor(prisma, adminUser!.id);
  operatorCookie = await sessionCookieFor(prisma, operatorUser!.id);
});

afterAll(async () => {
  if (prisma) {
    await prisma.eventRegistrationSettings.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.identityProvider.deleteMany({ where: { issuer: IDP_ISSUER } });
    await prisma.adminAuditLog.deleteMany({ where: { action_type: { startsWith: "registration_" } } });
    await cleanSettings();
    await prisma.$disconnect();
  }
});

describe("who may use the registration settings routes", () => {
  it.each(ROUTES.map((route) => [`${route.method} ${route.path}`, route] as const))(
    "%s: signed out is 401, an operator or an organisation admin is 403, and nothing is written",
    async (_label, route) => {
      expect((await call(route)).status).toBe(401);
      expect((await call(route, operatorCookie)).status).toBe(403);
      const asAdmin = await call(route, adminCookie);
      expect(asAdmin.status).toBe(403);
      expect(await asAdmin.json()).toEqual({ error: "forbidden" });
      expect(await storedValue(TURNSTILE_SETTINGS_KEY)).toBeNull();
      expect(await storedValue(ACCESS_METHODS_SETTINGS_KEY)).toBeNull();
      expect(await auditRows()).toHaveLength(0);
    },
  );

  it("checks the browser's origin on a write", async () => {
    const body = JSON.stringify({ site_key: SITE_KEY });
    const noOrigin = await app.request("/api/admin/registration/turnstile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: superCookie },
      body,
    });
    expect(noOrigin.status).toBe(403);
    const otherSite = await app.request("/api/admin/registration/turnstile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example.net", Cookie: superCookie },
      body,
    });
    expect(otherSite.status).toBe(403);
    const noOriginDelete = await app.request("/api/admin/registration/turnstile", {
      method: "DELETE",
      headers: { Cookie: superCookie },
    });
    expect(noOriginDelete.status).toBe(403);
    expect(await storedValue(TURNSTILE_SETTINGS_KEY)).toBeNull();
  });

  it("caps the size of a write before it is read", async () => {
    const res = await put("/api/admin/registration/turnstile", { site_key: SITE_KEY, secret_key: "x".repeat(200_000) });
    expect(res.status).toBe(400);
    // The body cap answers, not the field check (which would say validation_failed for the length).
    expect(await res.json()).toEqual({ error: "request too large" });
    expect(await storedValue(TURNSTILE_SETTINGS_KEY)).toBeNull();
  });
});

describe("Turnstile keys, end to end", () => {
  it("saves the keys encrypted, hands the secret back to nobody and audits the change", async () => {
    const res = await put("/api/admin/registration/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ site_key: SITE_KEY, secret_set: true, status: "ready" });
    expect(text).not.toContain(SECRET);

    const stored = (await storedValue(TURNSTILE_SETTINGS_KEY))!;
    expect(stored).not.toContain(SECRET);
    const { secretEnc } = JSON.parse(stored) as { secretEnc: string };
    expect(decryptFromString(secretEnc, SECRET_CONTEXTS.turnstileSecret)).toBe(SECRET);
    expect(() => decryptFromString(secretEnc, SECRET_CONTEXTS.imapPassword)).toThrow();

    const get = await app.request("/api/admin/registration/turnstile", { headers: { Cookie: superCookie } });
    const getText = await get.text();
    expect(JSON.parse(getText)).toEqual({ site_key: SITE_KEY, secret_set: true, status: "ready" });
    expect(getText).not.toContain(SECRET);

    const rows = await auditRows();
    expect(rows.map((row) => row.action_type)).toEqual(["registration_turnstile_updated"]);
    expect(rows[0]!.metadata).toEqual({ site_key: "set", secret_key: "set" });
    expect(JSON.stringify(rows[0])).not.toContain(SECRET);
    expect(rows[0]!.actor_email).toBe(EMAILS.superadmin);
    // Scoped to the instance organisation, which is what the Audit log tab lists.
    expect(rows[0]!.organization_id).toBe(await resolveInstanceOrganizationId(prisma));
  });

  it("shows the change in the Audit log, without a value", async () => {
    const res = await app.request("/api/admin/audit-log?action_type=registration_turnstile_updated", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { total: number; entries: Array<{ action_type: string; metadata: unknown }> };
    expect(body.total).toBe(1);
    expect(body.entries[0]).toMatchObject({
      action_type: "registration_turnstile_updated",
      metadata: { site_key: "set", secret_key: "set" },
    });
    expect(text).not.toContain(SECRET);
  });

  it("does not leak into the generic system settings answer", async () => {
    const res = await app.request("/api/admin/system-settings", { headers: { Cookie: superCookie } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(SITE_KEY);
    expect(text).not.toContain("secretEnc");
    expect(text).not.toContain("registration_turnstile");
  });

  it("refuses to take a key through the generic system settings route", async () => {
    const res = await app.request("/api/admin/system-settings", {
      method: "PATCH",
      headers: { ...jsonHeaders, Cookie: superCookie },
      body: JSON.stringify({ registration_turnstile: { siteKey: "x", secretEnc: "y" } }),
    });
    expect(res.status).toBe(400);
    expect(JSON.parse((await storedValue(TURNSTILE_SETTINGS_KEY))!)).toMatchObject({ siteKey: SITE_KEY });
  });

  it("lets the verifier use the saved secret, and closes the form when it is removed", async () => {
    const seen: string[] = [];
    const answer = () =>
      new Response(
        JSON.stringify({ success: true, hostname: "tickets.example.com", cdata: botChallengeCData(EVENT_SLUG), "error-codes": [] }),
        { status: 200 },
      );
    const fetchFn = (async (_input: string | URL, init?: RequestInit) => {
      seen.push(new URLSearchParams(String(init?.body)).get("secret") ?? "");
      return answer();
    }) as unknown as typeof fetch;
    const input = { token: "tok", expectedHosts: ["tickets.example.com"], slug: EVENT_SLUG };

    expect(await verifyBotChallenge(prisma, input, { fetch: fetchFn })).toEqual({ ok: true });
    expect(seen).toEqual([SECRET]);

    const res = await app.request("/api/admin/registration/turnstile", { method: "DELETE", headers: { ...sameOrigin, Cookie: superCookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ site_key: null, secret_set: false, status: "incomplete" });
    expect(await storedValue(TURNSTILE_SETTINGS_KEY)).toBeNull();
    expect(await verifyBotChallenge(prisma, input, { fetch: fetchFn })).toEqual({ ok: false, reason: "not_configured" });
    expect(seen).toEqual([SECRET]);
    expect((await auditRows()).map((row) => row.action_type)).toEqual([
      "registration_turnstile_updated",
      "registration_turnstile_cleared",
    ]);
  });

  it("keeps both halves when two superadmins save at once, one the site key and one the secret", async () => {
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });
    await put("/api/admin/registration/turnstile", { site_key: "0x4AAAAAAAstart", secret_key: "startSecretValue" });
    for (let round = 0; round < 12; round++) {
      const siteKey = `0x4AAAAAAAround${round}`;
      const secret = `secretRound${round}Value`;
      const [first, second] = await Promise.all([
        put("/api/admin/registration/turnstile", { site_key: siteKey }),
        put("/api/admin/registration/turnstile", { secret_key: secret }),
      ]);
      expect([first.status, second.status]).toEqual([200, 200]);
      const stored = JSON.parse((await storedValue(TURNSTILE_SETTINGS_KEY))!) as { siteKey: string; secretEnc: string };
      expect(stored.siteKey).toBe(siteKey);
      expect(decryptFromString(stored.secretEnc, SECRET_CONTEXTS.turnstileSecret)).toBe(secret);
    }
  });

  it("keeps the old keys when a write is refused", async () => {
    await put("/api/admin/registration/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    const before = await storedValue(TURNSTILE_SETTINGS_KEY);
    const refused = await put("/api/admin/registration/turnstile", { site_key: "bad key with spaces", secret_key: "other" });
    expect(refused.status).toBe(400);
    expect(await storedValue(TURNSTILE_SETTINGS_KEY)).toBe(before);
  });

  it("reports a secret that cannot be decrypted instead of calling the form ready", async () => {
    await prisma.systemSettings.upsert({
      where: { key: TURNSTILE_SETTINGS_KEY },
      create: { key: TURNSTILE_SETTINGS_KEY, value_json: JSON.stringify({ siteKey: SITE_KEY, secretEnc: encryptToString(SECRET, "another-purpose") }) },
      update: { value_json: JSON.stringify({ siteKey: SITE_KEY, secretEnc: encryptToString(SECRET, "another-purpose") }) },
    });
    const get = await app.request("/api/admin/registration/turnstile", { headers: { Cookie: superCookie } });
    expect(await get.json()).toEqual({ site_key: SITE_KEY, secret_set: true, status: "unreadable" });
  });
});

describe("registration_captcha in the Health check", () => {
  const healthRow = async () => {
    const res = await app.request("/api/admin/health", { headers: { Cookie: superCookie } });
    expect(res.status).toBe(200);
    const report = (await res.json()) as { groups: Array<{ id: string; checks: Array<{ id: string; status: string; summary: string }> }> };
    return report.groups.find((group) => group.id === "external")!.checks.find((check) => check.id === "registration_captcha")!;
  };

  // The row counts every event of the instance. Another test file that ran earlier in this worker's schema may
  // have left an event with registration on, so start each test with this file's own event only.
  beforeEach(async () => {
    await prisma.eventRegistrationSettings.deleteMany({ where: { event_id: { not: EVENT_ID } } });
  });

  it("stays quiet until an event uses registration, warns then, and is ok with the keys", async () => {
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });

    expect(await healthRow()).toMatchObject({ status: "not_configured", summary: "Not configured" });

    await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT_ID, mode: "automatic", access_methods: ["link"] } });
    expect(await healthRow()).toMatchObject({
      status: "degraded",
      summary: "Registration by link or password is on for 1 event, but the keys are not set",
    });

    await put("/api/admin/registration/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    expect(await healthRow()).toMatchObject({ status: "ok", summary: "Configured" });
  });

  it("does not count an archived event", async () => {
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });
    await prisma.event.update({ where: { id: EVENT_ID }, data: { archived_at: new Date() } });
    try {
      expect(await healthRow()).toMatchObject({ status: "not_configured" });
    } finally {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { archived_at: null } });
    }
  });

  it("does not count an event that offers only SSO, which needs no challenge, but counts one with a password", async () => {
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });
    await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT_ID }, data: { mode: "approval", access_methods: ["sso"] } });
    expect(await healthRow()).toMatchObject({ status: "not_configured" });

    await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT_ID }, data: { access_methods: [] } });
    expect(await healthRow()).toMatchObject({ status: "not_configured" });

    await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT_ID }, data: { access_methods: ["password"] } });
    expect(await healthRow()).toMatchObject({ status: "degraded" });
  });

  it("does not count an event whose registration is off", async () => {
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });
    await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT_ID }, data: { mode: null } });
    expect(await healthRow()).toMatchObject({ status: "not_configured" });
  });
});

describe("access methods, end to end", () => {
  it("start empty and unavailable", async () => {
    await cleanSettings();
    const res = await app.request("/api/admin/registration/access-methods", { headers: { Cookie: superCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { methods: Array<{ method: string; enabled: boolean; available: boolean }> };
    expect(body.methods.map((m) => [m.method, m.enabled, m.available])).toEqual([
      ["link", false, false],
      ["password", false, false],
      ["sso", false, false],
    ]);
  });

  it("make the link and the password available only with the keys, and SSO only with a provider", async () => {
    const enable = await put("/api/admin/registration/access-methods", { methods: ["link", "password", "sso"] });
    expect(enable.status).toBe(200);
    const before = (await enable.json()) as { methods: Array<{ method: string; available: boolean; blocked_by: string | null }> };
    expect(before.methods.map((m) => [m.method, m.available, m.blocked_by])).toEqual([
      ["link", false, "bot_protection"],
      ["password", false, "bot_protection"],
      ["sso", false, "identity_provider"],
    ]);

    await put("/api/admin/registration/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    await prisma.identityProvider.create({
      data: {
        issuer: IDP_ISSUER,
        client_id: "reg-settings-client",
        authorization_endpoint: `${IDP_ISSUER}/authorize`,
        token_endpoint: `${IDP_ISSUER}/token`,
        jwks_uri: `${IDP_ISSUER}/jwks`,
        display_name: "Reg Settings IdP",
        enabled: true,
      },
    });
    const after = await app.request("/api/admin/registration/access-methods", { headers: { Cookie: superCookie } });
    const body = (await after.json()) as { methods: Array<{ method: string; available: boolean }> };
    expect(body.methods.map((m) => [m.method, m.available])).toEqual([
      ["link", true],
      ["password", true],
      ["sso", true],
    ]);

    await prisma.identityProvider.updateMany({ where: { issuer: IDP_ISSUER }, data: { enabled: false } });
    const disabled = await app.request("/api/admin/registration/access-methods", { headers: { Cookie: superCookie } });
    const disabledBody = (await disabled.json()) as { methods: Array<{ method: string; available: boolean }> };
    expect(disabledBody.methods.find((m) => m.method === "sso")!.available).toBe(false);
  });

  it("are audited with the list that is now enabled", async () => {
    await put("/api/admin/registration/access-methods", { methods: ["password"] });
    const rows = (await auditRows()).filter((row) => row.action_type === "registration_access_methods_updated");
    expect(rows.at(-1)!.metadata).toEqual({ methods: ["password"] });
  });

  it("refuse an unknown method and keep the list as it was", async () => {
    const before = await storedValue(ACCESS_METHODS_SETTINGS_KEY);
    const res = await put("/api/admin/registration/access-methods", { methods: ["password", "carrier-pigeon"] });
    expect(res.status).toBe(400);
    expect(await storedValue(ACCESS_METHODS_SETTINGS_KEY)).toBe(before);
  });
});
