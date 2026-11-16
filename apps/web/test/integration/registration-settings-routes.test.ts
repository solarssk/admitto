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
import { BOT_PROTECTION_SETTINGS_KEY } from "../../src/registration/bot-protection-mode.js";
import { readRedirectUris } from "../../src/admin/registration-settings-routes.js";
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
  { method: "PUT", path: "/api/admin/registration/turnstile", body: { bot_protection: "not_used" } },
  { method: "POST", path: "/api/admin/registration/turnstile/test", body: {} },
  { method: "DELETE", path: "/api/admin/registration/turnstile" },
  { method: "GET", path: "/api/admin/registration/sso-provider" },
];

/** What the old screens called: the list of ways in the organisation enabled, and the one provider for the whole instance. */
const REMOVED_ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
  { method: "GET", path: "/api/admin/registration/access-methods" },
  { method: "PUT", path: "/api/admin/registration/access-methods", body: { methods: ["link"] } },
  { method: "PUT", path: "/api/admin/registration/sso-provider", body: { provider_id: null } },
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
  await prisma.systemSettings.deleteMany({
    where: { key: { in: [TURNSTILE_SETTINGS_KEY, BOT_PROTECTION_SETTINGS_KEY] } },
  });
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
      expect(await storedValue(BOT_PROTECTION_SETTINGS_KEY)).toBeNull();
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

describe("the mode of the bot check, end to end (A2)", () => {
  const cleanAll = async () => {
    await cleanSettings();
    await prisma.adminAuditLog.deleteMany({ where: { action_type: { startsWith: "registration_" } } });
  };
  beforeEach(cleanAll);
  // The tests after this block count the audit rows of their own writes.
  afterAll(cleanAll);

  it("is required by default, is set by a superadmin to not used and back, and each change is audited with the two modes", async () => {
    const first = await app.request("/api/admin/registration/turnstile", { headers: { Cookie: superCookie } });
    expect(await first.json()).toMatchObject({ bot_protection: "required" });

    const off = await put("/api/admin/registration/turnstile", { bot_protection: "not_used" });
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ bot_protection: "not_used", status: "incomplete" });
    expect(await storedValue(BOT_PROTECTION_SETTINGS_KEY)).toBe('"not_used"');
    expect(await storedValue(TURNSTILE_SETTINGS_KEY)).toBeNull();

    const on = await put("/api/admin/registration/turnstile", { bot_protection: "required" });
    expect(await on.json()).toMatchObject({ bot_protection: "required" });

    const rows = await auditRows();
    expect(rows.map((row) => row.action_type)).toEqual(["registration_bot_protection_updated", "registration_bot_protection_updated"]);
    expect(rows.map((row) => row.metadata)).toEqual([
      { mode: "not_used", previous_mode: "required" },
      { mode: "required", previous_mode: "not_used" },
    ]);
    expect(rows[0]!.actor_email).toBe(EMAILS.superadmin);
    expect(rows[0]!.organization_id).toBe(await resolveInstanceOrganizationId(prisma));
  });

  it("refuses a mode that is not one of the two, and writes nothing", async () => {
    const res = await put("/api/admin/registration/turnstile", { bot_protection: "off" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "validation_failed", fields: ["bot_protection"] });
    expect(await storedValue(BOT_PROTECTION_SETTINGS_KEY)).toBeNull();
    expect(await auditRows()).toHaveLength(0);
  });
});

describe("Turnstile keys, end to end", () => {
  it("saves the keys encrypted, hands the secret back to nobody and audits the change", async () => {
    const res = await put("/api/admin/registration/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ site_key: SITE_KEY, secret_set: true, status: "ready", bot_protection: "required" });
    expect(text).not.toContain(SECRET);

    const stored = (await storedValue(TURNSTILE_SETTINGS_KEY))!;
    expect(stored).not.toContain(SECRET);
    const { secretEnc } = JSON.parse(stored) as { secretEnc: string };
    expect(decryptFromString(secretEnc, SECRET_CONTEXTS.turnstileSecret)).toBe(SECRET);
    expect(() => decryptFromString(secretEnc, SECRET_CONTEXTS.imapPassword)).toThrow();

    const get = await app.request("/api/admin/registration/turnstile", { headers: { Cookie: superCookie } });
    const getText = await get.text();
    expect(JSON.parse(getText)).toEqual({ site_key: SITE_KEY, secret_set: true, status: "ready", bot_protection: "required" });
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
    expect(await res.json()).toEqual({ site_key: null, secret_set: false, status: "incomplete", bot_protection: "required" });
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
    expect(await get.json()).toEqual({ site_key: SITE_KEY, secret_set: true, status: "unreadable", bot_protection: "required" });
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

describe("the routes of the old ways in and provider screens", () => {
  it.each(REMOVED_ROUTES.map((route) => [`${route.method} ${route.path}`, route] as const))("%s is gone, also for a superadmin, and writes nothing", async (_label, route) => {
    const before = (await auditRows()).length;

    const res = await call(route, superCookie);

    expect(res.status).toBe(404);
    expect(await auditRows()).toHaveLength(before);
  });
});

describe("the return addresses of the guests' sign-in, end to end (D-C6)", () => {
  let providerId = "";

  beforeAll(async () => {
    await prisma.identityProvider.deleteMany({ where: { issuer: IDP_ISSUER } });
    providerId = (
      await prisma.identityProvider.create({
        data: {
          issuer: IDP_ISSUER,
          client_id: "reg-settings-client",
          authorization_endpoint: `${IDP_ISSUER}/authorize`,
          token_endpoint: `${IDP_ISSUER}/token`,
          jwks_uri: `${IDP_ISSUER}/jwks`,
          display_name: "Reg Settings IdP",
          client_secret_enc: "must-never-leave",
          enabled: true,
        },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.identityProvider.deleteMany({ where: { issuer: IDP_ISSUER } });
    await cleanSettings();
  });
  beforeEach(async () => {
    await cleanSettings();
  });

  const read = (cookie = superCookie) => app.request("/api/admin/registration/sso-provider", { headers: { Cookie: cookie } });

  type Offered = { redirect_uri: string | null };

  it("is for a superadmin alone: signed out is 401, an admin and an operator are 403, and nothing is written", async () => {
    for (const route of ROUTES.filter((candidate) => candidate.path.endsWith("/sso-provider"))) {
      expect((await call(route)).status, route.method).toBe(401);
      for (const cookie of [adminCookie, operatorCookie]) {
        const res = await call(route, cookie);
        expect(res.status, `${route.method} ${cookie.slice(0, 6)}`).toBe(403);
        expect(await res.json()).toEqual({ error: "forbidden" });
      }
    }
  });

  it("gives the one address the provider lists for the guests' sign-in, from the address of the instance, and no field of a provider", async () => {
    const read1 = (await (await read()).json()) as Offered;

    // The instance of this test has the address https://tickets.example.com; the sign-in builds its redirect on the same one.
    expect(read1.redirect_uri).toBe("https://tickets.example.com/sso/callback");
    expect(Object.keys(read1).sort()).toEqual(["redirect_uri", "redirect_uris"]);
  });

  it("builds the address from the saved Instance URL when the server has no BASE_URL and none is injected", async () => {
    const savedEnv = process.env.BASE_URL;
    delete process.env.BASE_URL;
    const saved = JSON.stringify("https://saved.example.com");
    await prisma.systemSettings.upsert({ where: { key: "instance_url" }, create: { key: "instance_url", value_json: saved }, update: { value_json: saved } });
    try {
      const fromSaved = createApp({ prisma, rateLimitStore: new InMemoryRateLimitStore(), skipCheckinBootValidation: true, adminDistRoot });
      const readOnce = await fromSaved.request("/api/admin/registration/sso-provider", { headers: { Cookie: superCookie } });

      expect(((await readOnce.json()) as Offered).redirect_uri).toBe("https://saved.example.com/sso/callback");
    } finally {
      if (savedEnv !== undefined) process.env.BASE_URL = savedEnv;
      await prisma.systemSettings.deleteMany({ where: { key: "instance_url" } });
    }
  });

  it("lists every return address the provider must hold: the instance's, then one per own address of an event that uses the sign-in (D-C6)", async () => {
    const rows = [
      // [slug, methods, domain, verified, archived]
      ["b", ["sso"], "b.acme.example", true, false],
      ["a", ["sso"], "a.acme.example", false, false],
      ["link", ["link"], "c.acme.example", true, false],
      ["archived", ["sso"], "d.acme.example", true, true],
      ["nodomain", ["sso"], null, false, false],
    ] as const;
    const ids = rows.map(([slug]) => `evt-reg-settings-uris-${slug}`);
    try {
      for (const [slug, methods, domain, verified, archived] of rows) {
        const id = `evt-reg-settings-uris-${slug}`;
        await prisma.event.create({
          data: { id, title: `Uris ${slug}`, slug: id, date: new Date("2026-12-01"), organization_id: ORG_ID, archived_at: archived ? new Date() : null },
        });
        await prisma.eventRegistrationSettings.create({
          data: { event_id: id, access_methods: [...methods], custom_domain: domain, custom_domain_verified_at: verified ? new Date() : null },
        });
      }
      const instance = { uri: "https://tickets.example.com/sso/callback", host: "instance", verified: true };
      const expected = [
        instance,
        { uri: "https://a.acme.example/sso/callback", host: "event_domain", verified: false },
        { uri: "https://b.acme.example/sso/callback", host: "event_domain", verified: true },
      ];

      const readBody = (await (await read()).json()) as Offered & { redirect_uris: unknown };

      expect(readBody.redirect_uris).toEqual(expected);
      // The one address of the instance stays where the screens that read one find it.
      expect(readBody.redirect_uri).toBe(instance.uri);
    } finally {
      await prisma.eventRegistrationSettings.deleteMany({ where: { event_id: { in: ids } } });
      await prisma.event.deleteMany({ where: { id: { in: ids } } });
    }
  });

  it("lists only the instance's address while no event has an address of its own, and none while the instance has none", async () => {
    const body = (await (await read()).json()) as Offered & { redirect_uris: unknown };
    expect(body.redirect_uris).toEqual([{ uri: "https://tickets.example.com/sso/callback", host: "instance", verified: true }]);
    expect(await readRedirectUris(prisma, null)).toEqual([]);
  });
});
