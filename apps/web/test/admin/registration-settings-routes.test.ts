import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { decryptFromString, SECRET_CONTEXTS } from "@admitto/crypto";
import type { PrismaClient } from "@admitto/db";

const { canManageInstance, writeAdminAuditLog } = vi.hoisted(() => ({
  canManageInstance: vi.fn(async () => true),
  // Typed arguments: under tsc, `mock.calls[0]` of an argument-less mock is an empty tuple.
  writeAdminAuditLog: vi.fn(async (_db: unknown, _entry: Record<string, unknown>) => undefined),
}));

vi.mock("@admitto/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/auth")>();
  return { ...actual, canManageInstance };
});
vi.mock("@admitto/tickets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/tickets")>();
  return { ...actual, writeAdminAuditLog };
});
vi.mock("../../src/admin/instance-org.js", () => ({ resolveInstanceOrganizationId: vi.fn(async () => "org-instance") }));

import {
  handleDeleteRegistrationTurnstile,
  handleGetRegistrationAccessMethods,
  handleGetRegistrationSsoProvider,
  handleGetRegistrationTurnstile,
  handlePutRegistrationAccessMethods,
  handlePutRegistrationSsoProvider,
  handlePutRegistrationTurnstile,
} from "../../src/admin/registration-settings-routes.js";
import { ACCESS_METHODS_SETTINGS_KEY } from "../../src/registration/access-methods.js";
import { SSO_PROVIDER_SETTINGS_KEY } from "../../src/registration/sso-provider.js";
import { TURNSTILE_SETTINGS_KEY } from "../../src/registration/turnstile-settings.js";
import { memorySystemSettings } from "../helpers/memory-system-settings.js";

const SITE_KEY = "0x4AAAAAAAsiteKEY";
const SECRET = "0x4AAAAAAAsecretKEYvalue";

type ProviderRow = { id: string; display_name: string; enabled: boolean; provider_type?: string };

/** SystemSettings in memory, with a transaction that really rolls back when its callback throws, and an identity provider table. */
function memoryDb(options: { providers?: ProviderRow[]; values?: Record<string, string> } = {}) {
  const memory = memorySystemSettings(options.values);
  const all = (options.providers ?? []).map((provider) => ({ provider_type: "oidc", ...provider }));
  const identityProvider = {
    findMany: vi.fn(async () => all.filter((provider) => provider.enabled && provider.provider_type === "oidc")),
    findFirst: vi.fn(async ({ where }: { where: { id: string; provider_type: string } }) =>
      all.find((provider) => provider.id === where.id && provider.provider_type === where.provider_type) ?? null,
    ),
  };
  const executeRaw = vi.fn(async () => 1);
  const db = {
    systemSettings: memory.systemSettings,
    identityProvider,
    $executeRaw: executeRaw,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const before = memory.snapshot();
      try {
        return await fn(db);
      } catch (err) {
        memory.restore(before);
        throw err;
      }
    }),
  };
  return { db: db as unknown as PrismaClient, rows: memory.rows, systemSettings: memory.systemSettings, identityProvider, executeRaw };
}

/** The address of the instance of these tests; the return address of the company sign-in is built on it. */
const INSTANCE_URL = "https://tickets.example.com";

function makeApp(db: PrismaClient, baseUrl: () => Promise<string> = async () => INSTANCE_URL) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("auth" as never, { userId: "user-1", sessionId: "sess-1" } as never);
    await next();
  });
  app.get("/turnstile", (c) => handleGetRegistrationTurnstile(c, db));
  app.put("/turnstile", (c) => handlePutRegistrationTurnstile(c, db));
  app.delete("/turnstile", (c) => handleDeleteRegistrationTurnstile(c, db));
  app.get("/access-methods", (c) => handleGetRegistrationAccessMethods(c, db));
  app.put("/access-methods", (c) => handlePutRegistrationAccessMethods(c, db));
  app.get("/sso-provider", (c) => handleGetRegistrationSsoProvider(c, db, baseUrl));
  app.put("/sso-provider", (c) => handlePutRegistrationSsoProvider(c, db, baseUrl));
  return app;
}

const sendJson = (app: Hono, method: string, path: string, body: unknown) =>
  app.request(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  canManageInstance.mockResolvedValue(true);
  writeAdminAuditLog.mockResolvedValue(undefined);
});

describe("who may call the registration settings routes", () => {
  const requests: Array<[string, string, unknown]> = [
    ["GET", "/turnstile", undefined],
    ["PUT", "/turnstile", { site_key: SITE_KEY }],
    ["DELETE", "/turnstile", undefined],
    ["GET", "/access-methods", undefined],
    ["PUT", "/access-methods", { methods: ["link"] }],
    ["GET", "/sso-provider", undefined],
    ["PUT", "/sso-provider", { provider_id: "idp-1" }],
  ];

  it.each(requests)("%s %s is forbidden for anyone who is not a superadmin, and touches nothing", async (method, path, body) => {
    canManageInstance.mockResolvedValue(false);
    const { db, rows, systemSettings, executeRaw } = memoryDb();
    const app = makeApp(db);
    const res = body === undefined ? await app.request(path, { method }) : await sendJson(app, method, path, body);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(canManageInstance).toHaveBeenCalledWith(db, "user-1");
    expect(systemSettings.findUnique).not.toHaveBeenCalled();
    expect(systemSettings.upsert).not.toHaveBeenCalled();
    expect(systemSettings.deleteMany).not.toHaveBeenCalled();
    expect(writeAdminAuditLog).not.toHaveBeenCalled();
    expect(rows().size).toBe(0);
    expect(executeRaw).not.toHaveBeenCalled();
  });
});

describe("Turnstile keys", () => {
  it("starts empty", async () => {
    const res = await makeApp(memoryDb().db).request("/turnstile");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ site_key: null, secret_set: false, status: "incomplete" });
  });

  it("saves both keys, answers without the secret and keeps the secret only as ciphertext", async () => {
    const { db, rows } = memoryDb();
    const res = await sendJson(makeApp(db), "PUT", "/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ site_key: SITE_KEY, secret_set: true, status: "ready" });
    expect(text).not.toContain(SECRET);

    const stored = rows().get(TURNSTILE_SETTINGS_KEY)!;
    expect(stored).not.toContain(SECRET);
    const { secretEnc } = JSON.parse(stored) as { secretEnc: string };
    expect(decryptFromString(secretEnc, SECRET_CONTEXTS.turnstileSecret)).toBe(SECRET);

    const get = await makeApp(db).request("/turnstile");
    const getText = await get.text();
    expect(JSON.parse(getText)).toEqual({ site_key: SITE_KEY, secret_set: true, status: "ready" });
    expect(getText).not.toContain(SECRET);
  });

  it("audits the change with field names and what happened to them, never a value", async () => {
    const { db } = memoryDb();
    await sendJson(makeApp(db), "PUT", "/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    expect(writeAdminAuditLog).toHaveBeenCalledTimes(1);
    const entry = writeAdminAuditLog.mock.calls[0]![1];
    expect(entry).toMatchObject({
      organizationId: "org-instance",
      actorUserId: "user-1",
      sessionId: "sess-1",
      actionType: "registration_turnstile_updated",
      metadata: { site_key: "set", secret_key: "set" },
    });
    expect(JSON.stringify(entry)).not.toContain(SECRET);
    expect(JSON.stringify(entry)).not.toContain(SITE_KEY);
  });

  it("changes one key and keeps the other", async () => {
    const { db } = memoryDb();
    const app = makeApp(db);
    await sendJson(app, "PUT", "/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    const res = await sendJson(app, "PUT", "/turnstile", { site_key: "0x4AAAAAAAnewSite" });
    expect(await res.json()).toEqual({ site_key: "0x4AAAAAAAnewSite", secret_set: true, status: "ready" });
    expect(writeAdminAuditLog.mock.calls[1]![1]).toMatchObject({ metadata: { site_key: "set", secret_key: "unchanged" } });
  });

  it("clears one key with null", async () => {
    const { db } = memoryDb();
    const app = makeApp(db);
    await sendJson(app, "PUT", "/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    const res = await sendJson(app, "PUT", "/turnstile", { secret_key: null });
    expect(await res.json()).toEqual({ site_key: SITE_KEY, secret_set: false, status: "incomplete" });
    expect(writeAdminAuditLog.mock.calls[1]![1]).toMatchObject({ metadata: { site_key: "unchanged", secret_key: "cleared" } });
  });

  it("trims a pasted key", async () => {
    const { db } = memoryDb();
    const res = await sendJson(makeApp(db), "PUT", "/turnstile", { site_key: `  ${SITE_KEY}\n`, secret_key: ` ${SECRET} ` });
    expect(await res.json()).toEqual({ site_key: SITE_KEY, secret_set: true, status: "ready" });
  });

  it("takes the settings lock before it writes the keys, and before it removes them", async () => {
    const { db, executeRaw, systemSettings } = memoryDb();
    const order: string[] = [];
    executeRaw.mockImplementation(async () => {
      order.push("lock");
      return 1;
    });
    systemSettings.upsert.mockImplementation(async () => {
      order.push("write");
    });
    systemSettings.deleteMany.mockImplementation(async () => {
      order.push("delete");
      return { count: 1 };
    });
    const app = makeApp(db);
    await sendJson(app, "PUT", "/turnstile", { site_key: SITE_KEY });
    await app.request("/turnstile", { method: "DELETE" });
    expect(order).toEqual(["lock", "write", "lock", "delete"]);
  });

  it("removes both keys and audits it", async () => {
    const { db, rows } = memoryDb();
    const app = makeApp(db);
    await sendJson(app, "PUT", "/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    const res = await app.request("/turnstile", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ site_key: null, secret_set: false, status: "incomplete" });
    expect(rows().has(TURNSTILE_SETTINGS_KEY)).toBe(false);
    expect(writeAdminAuditLog.mock.calls.at(-1)![1]).toMatchObject({ actionType: "registration_turnstile_cleared" });
  });

  describe("refuses a bad request without writing or auditing anything", () => {
    const bad: Array<[string, unknown, string[]]> = [
      ["no field at all", {}, []],
      ["an unknown field", { site_key: SITE_KEY, remote_ip: "1.2.3.4" }, []],
      ["a site key with markup", { site_key: '"><script>alert(1)</script>' }, ["site_key"]],
      ["an empty site key", { site_key: "" }, ["site_key"]],
      ["a site key that is a number", { site_key: 12 }, ["site_key"]],
      ["a secret with a space inside", { secret_key: "two words" }, ["secret_key"]],
      ["an empty secret", { secret_key: "" }, ["secret_key"]],
      ["a secret that is too long", { secret_key: "x".repeat(513) }, ["secret_key"]],
      ["a secret that is an object", { secret_key: { value: SECRET } }, ["secret_key"]],
      ["not an object", [SITE_KEY], []],
      ["null", null, []],
    ];

    it.each(bad)("%s", async (_name, body, fields) => {
      const { db, rows, systemSettings } = memoryDb();
      const res = await sendJson(makeApp(db), "PUT", "/turnstile", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "validation_failed", fields });
      expect(systemSettings.upsert).not.toHaveBeenCalled();
      expect(writeAdminAuditLog).not.toHaveBeenCalled();
      expect(rows().size).toBe(0);
    });

    it("does not echo a rejected secret back", async () => {
      const res = await sendJson(makeApp(memoryDb().db), "PUT", "/turnstile", { secret_key: "not a valid secret" });
      expect(res.status).toBe(400);
      expect(await res.text()).not.toContain("not a valid secret");
    });

    it("answers invalid_json for a body that is not JSON", async () => {
      const res = await makeApp(memoryDb().db).request("/turnstile", { method: "PUT", body: "{nope" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_json" });
    });
  });

  it("does not keep a change whose audit row could not be written", async () => {
    writeAdminAuditLog.mockRejectedValueOnce(new Error("audit table unavailable"));
    const { db, rows } = memoryDb();
    const res = await sendJson(makeApp(db), "PUT", "/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    expect(res.status).toBe(500);
    expect(rows().size).toBe(0);
  });

  it("does not remove the keys when the audit row could not be written", async () => {
    const { db, rows } = memoryDb();
    const app = makeApp(db);
    await sendJson(app, "PUT", "/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    writeAdminAuditLog.mockRejectedValueOnce(new Error("audit table unavailable"));
    const res = await app.request("/turnstile", { method: "DELETE" });
    expect(res.status).toBe(500);
    expect(rows().has(TURNSTILE_SETTINGS_KEY)).toBe(true);
  });
});

describe("access methods", () => {
  it("are all off to start with", async () => {
    const res = await makeApp(memoryDb().db).request("/access-methods");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      methods: [
        { method: "link", enabled: false, available: false, blocked_by: null },
        { method: "password", enabled: false, available: false, blocked_by: null },
        { method: "sso", enabled: false, available: false, blocked_by: null },
      ],
    });
  });

  it("can be enabled, and say what an enabled method still waits for", async () => {
    const { db, rows } = memoryDb();
    const res = await sendJson(makeApp(db), "PUT", "/access-methods", { methods: ["sso", "link", "link"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      methods: [
        { method: "link", enabled: true, available: false, blocked_by: "bot_protection" },
        { method: "password", enabled: false, available: false, blocked_by: null },
        { method: "sso", enabled: true, available: false, blocked_by: "identity_provider" },
      ],
    });
    expect(rows().get(ACCESS_METHODS_SETTINGS_KEY)).toBe('["link","sso"]');
    expect(writeAdminAuditLog.mock.calls[0]![1]).toMatchObject({
      actionType: "registration_access_methods_updated",
      metadata: { methods: ["link", "sso"] },
    });
  });

  it("make link and password available once the Turnstile keys are saved, and SSO with the provider chosen for guests", async () => {
    const { db } = memoryDb({ providers: [{ id: "idp-1", display_name: "Company IdP", enabled: true }] });
    const app = makeApp(db);
    await sendJson(app, "PUT", "/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    await sendJson(app, "PUT", "/sso-provider", { provider_id: "idp-1" });
    const res = await sendJson(app, "PUT", "/access-methods", { methods: ["link", "password", "sso"] });
    const body = (await res.json()) as { methods: Array<{ available: boolean }> };
    expect(body.methods.map((entry) => entry.available)).toEqual([true, true, true]);
  });

  it("are written without the keys lock, which only the Turnstile keys need", async () => {
    const { db, executeRaw } = memoryDb();
    await sendJson(makeApp(db), "PUT", "/access-methods", { methods: ["link"] });
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("can all be turned off again", async () => {
    const { db } = memoryDb();
    const app = makeApp(db);
    await sendJson(app, "PUT", "/access-methods", { methods: ["link"] });
    const res = await sendJson(app, "PUT", "/access-methods", { methods: [] });
    const body = (await res.json()) as { methods: Array<{ enabled: boolean }> };
    expect(body.methods.every((entry) => !entry.enabled)).toBe(true);
  });

  it.each([
    ["an unknown method", { methods: ["link", "email"] }],
    ["a method in the wrong case", { methods: ["Link"] }],
    ["a non-array", { methods: "link" }],
    ["too many entries", { methods: ["link", "password", "sso", "link"] }],
    ["no list", {}],
    ["an unknown field", { methods: [], extra: true }],
    ["a prototype key", { methods: ["__proto__"] }],
  ])("refuses %s and writes nothing", async (_name, body) => {
    const { db, rows } = memoryDb();
    const res = await sendJson(makeApp(db), "PUT", "/access-methods", body);
    expect(res.status).toBe(400);
    expect(rows().size).toBe(0);
    expect(writeAdminAuditLog).not.toHaveBeenCalled();
  });
});

describe("the identity provider guests sign in with (D-C4)", () => {
  const company = { id: "idp-1", display_name: "Company IdP", enabled: true };
  const other = { id: "idp-2", display_name: "Other IdP", enabled: true };
  const off = { id: "idp-off", display_name: "Switched off", enabled: false };
  const saml = { id: "idp-saml", display_name: "Not OIDC", enabled: true, provider_type: "cloudflare_access" };

  it("starts with no choice, and lists the enabled OIDC providers by id and name and nothing else", async () => {
    const res = await makeApp(memoryDb({ providers: [company, off, saml, other] }).db).request("/sso-provider");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      provider_id: null,
      state: "not_selected",
      providers: [
        { id: "idp-1", display_name: "Company IdP" },
        { id: "idp-2", display_name: "Other IdP" },
      ],
      redirect_uri: `${INSTANCE_URL}/sso/callback`,
    });
  });

  it("gives a null return address, on the read and on the write, while the instance has no address, and still answers", async () => {
    const noAddress = () => Promise.reject(new Error("no instance url"));
    const app = makeApp(memoryDb({ providers: [company] }).db, noAddress);

    const read = await app.request("/sso-provider");
    const write = await sendJson(app, "PUT", "/sso-provider", { provider_id: "idp-1" });

    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ provider_id: null, redirect_uri: null });
    expect(write.status).toBe(200);
    expect(await write.json()).toMatchObject({ provider_id: "idp-1", state: "ready", redirect_uri: null });
  });

  it("gives the same return address on the write as on the read", async () => {
    const app = makeApp(memoryDb({ providers: [company] }).db);

    const write = await sendJson(app, "PUT", "/sso-provider", { provider_id: "idp-1" });

    expect(await write.json()).toMatchObject({ redirect_uri: `${INSTANCE_URL}/sso/callback` });
  });

  it("chooses an enabled provider, saves its id and nothing of it, and audits the ids before and after", async () => {
    const { db, rows } = memoryDb({ providers: [company, other] });
    const app = makeApp(db);

    const first = await sendJson(app, "PUT", "/sso-provider", { provider_id: "idp-1" });
    const second = await sendJson(app, "PUT", "/sso-provider", { provider_id: "idp-2" });

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ provider_id: "idp-1", state: "ready" });
    expect(await second.json()).toMatchObject({ provider_id: "idp-2", state: "ready" });
    expect(rows().get(SSO_PROVIDER_SETTINGS_KEY)).toBe('"idp-2"');
    expect(writeAdminAuditLog.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({
        actionType: "registration_sso_provider_updated",
        organizationId: "org-instance",
        actorUserId: "user-1",
        metadata: { provider_id: "idp-1", previous_provider_id: null },
      }),
      expect.objectContaining({
        actionType: "registration_sso_provider_updated",
        metadata: { provider_id: "idp-2", previous_provider_id: "idp-1" },
      }),
    ]);
  });

  it("removes the choice with null", async () => {
    const { db, rows } = memoryDb({ providers: [company], values: { [SSO_PROVIDER_SETTINGS_KEY]: '"idp-1"' } });

    const res = await sendJson(makeApp(db), "PUT", "/sso-provider", { provider_id: null });

    expect(await res.json()).toMatchObject({ provider_id: null, state: "not_selected" });
    expect(rows().has(SSO_PROVIDER_SETTINGS_KEY)).toBe(false);
    expect(writeAdminAuditLog.mock.calls[0]![1]).toMatchObject({ metadata: { provider_id: null, previous_provider_id: "idp-1" } });
  });

  it.each([
    ["one that does not exist", "idp-nowhere"],
    ["one that is switched off", "idp-off"],
    ["one that is not an OIDC provider", "idp-saml"],
  ])("refuses %s with one answer, and writes and audits nothing", async (_name, providerId) => {
    const { db, rows } = memoryDb({ providers: [company, off, saml] });

    const res = await sendJson(makeApp(db), "PUT", "/sso-provider", { provider_id: providerId });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "provider_not_available" });
    expect(rows().size).toBe(0);
    expect(writeAdminAuditLog).not.toHaveBeenCalled();
  });

  it.each([
    ["no field", {}],
    ["a number", { provider_id: 7 }],
    ["an empty id", { provider_id: "" }],
    ["an id that is a blank", { provider_id: "   " }],
    ["an unknown field", { provider_id: "idp-1", enabled: true }],
  ])("refuses %s with a 400 and writes nothing", async (_name, body) => {
    const { db, rows } = memoryDb({ providers: [company] });

    const res = await sendJson(makeApp(db), "PUT", "/sso-provider", body);

    expect(res.status).toBe(400);
    expect(rows().size).toBe(0);
    expect(writeAdminAuditLog).not.toHaveBeenCalled();
  });

  it("says where the choice stands when the provider was switched off or deleted since, and keeps the choice", async () => {
    const values = { [SSO_PROVIDER_SETTINGS_KEY]: '"idp-off"' };

    const switchedOff = await makeApp(memoryDb({ providers: [company, off], values }).db).request("/sso-provider");
    const deleted = await makeApp(memoryDb({ providers: [company], values }).db).request("/sso-provider");

    expect(await switchedOff.json()).toMatchObject({ provider_id: "idp-off", state: "disabled" });
    expect(await deleted.json()).toMatchObject({ provider_id: "idp-off", state: "missing" });
  });

  it("saves nothing when the audit entry cannot be written", async () => {
    const { db, rows } = memoryDb({ providers: [company] });
    writeAdminAuditLog.mockRejectedValueOnce(new Error("audit table unavailable"));

    const res = await sendJson(makeApp(db), "PUT", "/sso-provider", { provider_id: "idp-1" });

    expect(res.status).toBe(500);
    expect(rows().has(SSO_PROVIDER_SETTINGS_KEY)).toBe(false);
  });
});
