import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  handleGetRegistrationSsoProvider,
  handleGetRegistrationTurnstile,
  handlePostRegistrationTurnstileTest,
  handlePutRegistrationTurnstile,
} from "../../src/admin/registration-settings-routes.js";
import { readRedirectUris } from "../../src/admin/registration-settings-routes.js";
import { BOT_PROTECTION_SETTINGS_KEY } from "../../src/registration/bot-protection-mode.js";
import { ssoProviderKind } from "../../src/registration/sso-provider.js";
import { TURNSTILE_SETTINGS_KEY } from "../../src/registration/turnstile-settings.js";
import { memorySystemSettings } from "../helpers/memory-system-settings.js";

const SITE_KEY = "0x4AAAAAAAsiteKEY";
const SECRET = "0x4AAAAAAAsecretKEYvalue";

type ProviderRow = { id: string; display_name: string; issuer?: string; enabled: boolean; provider_type?: string };

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
  // The own addresses of events that use the sign-in (D-C6): none in these tests, the integration test has them.
  const eventRegistrationSettings = { findMany: vi.fn(async (): Promise<unknown[]> => []) };
  const executeRaw = vi.fn(async () => 1);
  const db = {
    eventRegistrationSettings,
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
  return { db: db as unknown as PrismaClient, rows: memory.rows, systemSettings: memory.systemSettings, identityProvider, eventRegistrationSettings, executeRaw };
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
  app.post("/turnstile/test", (c) => handlePostRegistrationTurnstileTest(c, db));
  app.delete("/turnstile", (c) => handleDeleteRegistrationTurnstile(c, db));
  app.get("/sso-provider", (c) => handleGetRegistrationSsoProvider(c, db, baseUrl));
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
    ["PUT", "/turnstile", { bot_protection: "not_used" }],
    ["POST", "/turnstile/test", {}],
    ["DELETE", "/turnstile", undefined],
    ["GET", "/sso-provider", undefined],
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
    expect(await res.json()).toEqual({ site_key: null, secret_set: false, status: "incomplete", bot_protection: "required" });
  });

  it("saves both keys, answers without the secret and keeps the secret only as ciphertext", async () => {
    const { db, rows } = memoryDb();
    const res = await sendJson(makeApp(db), "PUT", "/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ site_key: SITE_KEY, secret_set: true, status: "ready", bot_protection: "required" });
    expect(text).not.toContain(SECRET);

    const stored = rows().get(TURNSTILE_SETTINGS_KEY)!;
    expect(stored).not.toContain(SECRET);
    const { secretEnc } = JSON.parse(stored) as { secretEnc: string };
    expect(decryptFromString(secretEnc, SECRET_CONTEXTS.turnstileSecret)).toBe(SECRET);

    const get = await makeApp(db).request("/turnstile");
    const getText = await get.text();
    expect(JSON.parse(getText)).toEqual({ site_key: SITE_KEY, secret_set: true, status: "ready", bot_protection: "required" });
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
    expect(await res.json()).toEqual({ site_key: "0x4AAAAAAAnewSite", secret_set: true, status: "ready", bot_protection: "required" });
    expect(writeAdminAuditLog.mock.calls[1]![1]).toMatchObject({ metadata: { site_key: "set", secret_key: "unchanged" } });
  });

  it("clears one key with null", async () => {
    const { db } = memoryDb();
    const app = makeApp(db);
    await sendJson(app, "PUT", "/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    const res = await sendJson(app, "PUT", "/turnstile", { secret_key: null });
    expect(await res.json()).toEqual({ site_key: SITE_KEY, secret_set: false, status: "incomplete", bot_protection: "required" });
    expect(writeAdminAuditLog.mock.calls[1]![1]).toMatchObject({ metadata: { site_key: "unchanged", secret_key: "cleared" } });
  });

  it("trims a pasted key", async () => {
    const { db } = memoryDb();
    const res = await sendJson(makeApp(db), "PUT", "/turnstile", { site_key: `  ${SITE_KEY}\n`, secret_key: ` ${SECRET} ` });
    expect(await res.json()).toEqual({ site_key: SITE_KEY, secret_set: true, status: "ready", bot_protection: "required" });
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
    expect(await res.json()).toEqual({ site_key: null, secret_set: false, status: "incomplete", bot_protection: "required" });
    expect(rows().has(TURNSTILE_SETTINGS_KEY)).toBe(false);
    expect(writeAdminAuditLog.mock.calls.at(-1)![1]).toMatchObject({ actionType: "registration_turnstile_cleared" });
  });

  describe("the mode of the bot check (A2)", () => {
    const modeAudits = () => writeAdminAuditLog.mock.calls.filter((call) => call[1]["actionType"] === "registration_bot_protection_updated");

    it("is required until a superadmin decides, and the answer says so", async () => {
      const res = await makeApp(memoryDb().db).request("/turnstile");
      expect(await res.json()).toMatchObject({ bot_protection: "required" });
    });

    it("is changed alone, with no key in the request, and audited as its own entry with the two modes and nothing else", async () => {
      const { db, rows } = memoryDb();
      const res = await sendJson(makeApp(db), "PUT", "/turnstile", { bot_protection: "not_used" });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ site_key: null, secret_set: false, status: "incomplete", bot_protection: "not_used" });
      expect(rows().get(BOT_PROTECTION_SETTINGS_KEY)).toBe('"not_used"');
      // The keys were not touched: no row of theirs, and no entry about them.
      expect(rows().has(TURNSTILE_SETTINGS_KEY)).toBe(false);
      expect(writeAdminAuditLog).toHaveBeenCalledTimes(1);
      expect(writeAdminAuditLog.mock.calls[0]![1]).toMatchObject({
        organizationId: "org-instance",
        actionType: "registration_bot_protection_updated",
        metadata: { mode: "not_used", previous_mode: "required" },
      });
    });

    it("is changed back the same way, and the entry names where it came from", async () => {
      const { db } = memoryDb();
      const app = makeApp(db);
      await sendJson(app, "PUT", "/turnstile", { bot_protection: "not_used" });
      const res = await sendJson(app, "PUT", "/turnstile", { bot_protection: "required" });

      expect(await res.json()).toMatchObject({ bot_protection: "required" });
      expect(modeAudits().map((call) => call[1]["metadata"])).toEqual([
        { mode: "not_used", previous_mode: "required" },
        { mode: "required", previous_mode: "not_used" },
      ]);
    });

    it("writes nothing and audits nothing when the mode is the one it is", async () => {
      const { db, rows, systemSettings } = memoryDb();
      const res = await sendJson(makeApp(db), "PUT", "/turnstile", { bot_protection: "required" });

      expect(res.status).toBe(200);
      expect(systemSettings.upsert).not.toHaveBeenCalled();
      expect(rows().size).toBe(0);
      expect(writeAdminAuditLog).not.toHaveBeenCalled();
    });

    it("is saved with the keys in one request, as two entries, the keys' first", async () => {
      const { db } = memoryDb();
      const res = await sendJson(makeApp(db), "PUT", "/turnstile", { site_key: SITE_KEY, secret_key: SECRET, bot_protection: "not_used" });

      expect(await res.json()).toEqual({ site_key: SITE_KEY, secret_set: true, status: "ready", bot_protection: "not_used" });
      expect(writeAdminAuditLog.mock.calls.map((call) => call[1]["actionType"])).toEqual([
        "registration_turnstile_updated",
        "registration_bot_protection_updated",
      ]);
    });

    it("is kept when the keys are removed: the two settings are separate", async () => {
      const { db, rows } = memoryDb();
      const app = makeApp(db);
      await sendJson(app, "PUT", "/turnstile", { site_key: SITE_KEY, secret_key: SECRET, bot_protection: "not_used" });
      const res = await app.request("/turnstile", { method: "DELETE" });

      expect(await res.json()).toEqual({ site_key: null, secret_set: false, status: "incomplete", bot_protection: "not_used" });
      expect(rows().get(BOT_PROTECTION_SETTINGS_KEY)).toBe('"not_used"');
    });

    it("rolls back with the keys' audit entry when the entry of the mode cannot be written", async () => {
      const { db, rows } = memoryDb();
      writeAdminAuditLog.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("audit down"));
      const res = await sendJson(makeApp(db), "PUT", "/turnstile", { site_key: SITE_KEY, bot_protection: "not_used" });

      expect(res.status).toBe(500);
      expect(rows().has(BOT_PROTECTION_SETTINGS_KEY)).toBe(false);
      expect(rows().has(TURNSTILE_SETTINGS_KEY)).toBe(false);
    });
  });

  describe("refuses a bad request without writing or auditing anything", () => {
    const bad: Array<[string, unknown, string[]]> = [
      ["no field at all", {}, []],
      ["a mode that is not one", { bot_protection: "off" }, ["bot_protection"]],
      ["a mode with other letters", { bot_protection: "Not_Used" }, ["bot_protection"]],
      ["a mode that is a boolean", { bot_protection: false }, ["bot_protection"]],
      ["a mode that is null", { bot_protection: null }, ["bot_protection"]],
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

describe("testing the Turnstile secret key", () => {
  const cloudflare = (body: unknown) => vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(JSON.stringify(body)));
  const KNOWN = { success: false, "error-codes": ["invalid-input-response"] };
  const UNKNOWN = { success: false, "error-codes": ["invalid-input-secret"] };
  const sentSecret = (fetchFn: ReturnType<typeof cloudflare>) => new URLSearchParams(String(fetchFn.mock.calls[0]![1]!.body)).get("secret");

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function saved() {
    const memory = memoryDb();
    await sendJson(makeApp(memory.db), "PUT", "/turnstile", { site_key: SITE_KEY, secret_key: SECRET });
    return memory;
  }

  it("checks the saved secret when none is typed, and says Cloudflare accepted it", async () => {
    const fetchFn = cloudflare(KNOWN);
    vi.stubGlobal("fetch", fetchFn);
    const { db } = await saved();
    const res = await sendJson(makeApp(db), "POST", "/turnstile/test", {});
    expect(await res.json()).toEqual({ ok: true, message: "Cloudflare accepted the secret key." });
    expect(sentSecret(fetchFn)).toBe(SECRET);
  });

  it("checks the typed secret instead of the saved one, trimmed, and saves nothing", async () => {
    const fetchFn = cloudflare(KNOWN);
    vi.stubGlobal("fetch", fetchFn);
    const { db, rows } = await saved();
    const before = rows().get(TURNSTILE_SETTINGS_KEY);
    writeAdminAuditLog.mockClear();
    const res = await sendJson(makeApp(db), "POST", "/turnstile/test", { secret_key: " typedSecret " });
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(sentSecret(fetchFn)).toBe("typedSecret");
    expect(rows().get(TURNSTILE_SETTINGS_KEY)).toBe(before);
    expect(writeAdminAuditLog).not.toHaveBeenCalled();
  });

  it("works with a typed secret before anything is saved", async () => {
    vi.stubGlobal("fetch", cloudflare(KNOWN));
    const res = await sendJson(makeApp(memoryDb().db), "POST", "/turnstile/test", { secret_key: SECRET });
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("says the key is wrong without echoing it", async () => {
    vi.stubGlobal("fetch", cloudflare(UNKNOWN));
    const { db } = await saved();
    const text = await (await sendJson(makeApp(db), "POST", "/turnstile/test", {})).text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: "Cloudflare did not accept the secret key. Check it in the Cloudflare dashboard." });
    expect(text).not.toContain(SECRET);
  });

  it("says Cloudflare could not be reached when there is no usable answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("boom"))));
    const { db } = await saved();
    const body = await (await sendJson(makeApp(db), "POST", "/turnstile/test", {})).json();
    expect(body).toEqual({ ok: false, error: "Could not reach Cloudflare. Try again in a moment." });
  });

  it("asks for a secret when none is saved or typed, without calling Cloudflare", async () => {
    const fetchFn = cloudflare(KNOWN);
    vi.stubGlobal("fetch", fetchFn);
    const body = await (await sendJson(makeApp(memoryDb().db), "POST", "/turnstile/test", {})).json();
    expect(body).toEqual({ ok: false, error: "Enter the secret key first." });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("says a saved secret that cannot be read must be entered again, without calling Cloudflare", async () => {
    const fetchFn = cloudflare(KNOWN);
    vi.stubGlobal("fetch", fetchFn);
    const { db } = memoryDb({ values: { [TURNSTILE_SETTINGS_KEY]: JSON.stringify({ siteKey: SITE_KEY, secretEnc: "not-a-ciphertext" }) } });
    const body = await (await sendJson(makeApp(db), "POST", "/turnstile/test", {})).json();
    expect(body).toEqual({ ok: false, error: "The saved secret key cannot be read. Enter the secret key again." });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ["a secret with a space", { secret_key: "two words" }],
    ["a null secret", { secret_key: null }],
    ["an unknown field", { site_key: SITE_KEY }],
  ])("refuses %s without calling Cloudflare", async (_name, body) => {
    const fetchFn = cloudflare(KNOWN);
    vi.stubGlobal("fetch", fetchFn);
    const res = await sendJson(makeApp(memoryDb().db), "POST", "/turnstile/test", body);
    expect(res.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    const res = await makeApp(memoryDb().db).request("/turnstile/test", { method: "POST", body: "{" });
    expect(res.status).toBe(400);
  });
});

describe("the return addresses of the guests' sign-in (D-C6)", () => {
  it("leaves out a row that has no address of its own, lists the others sorted, and none of the instance's while the instance has none", async () => {
    const { db, eventRegistrationSettings } = memoryDb();
    eventRegistrationSettings.findMany.mockResolvedValueOnce([
      { custom_domain: "b.acme.example", custom_domain_verified_at: new Date() },
      { custom_domain: null, custom_domain_verified_at: null },
      { custom_domain: "a.acme.example", custom_domain_verified_at: null },
    ] as never);

    expect(await readRedirectUris(db, null)).toEqual([
      { uri: "https://a.acme.example/sso/callback", host: "event_domain", verified: false },
      { uri: "https://b.acme.example/sso/callback", host: "event_domain", verified: true },
    ]);
  });
});

describe("the return addresses of the guests' sign-in, as the one route answers them", () => {
  const company = { id: "idp-1", display_name: "Company IdP", issuer: "https://login.microsoftonline.com/tenant-a/v2.0", enabled: true };

  it("answers the return addresses and nothing of an identity provider: the provider is the event's own choice", async () => {
    const { db, systemSettings } = memoryDb({ providers: [company] });
    const res = await makeApp(db).request("/sso-provider");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      redirect_uri: `${INSTANCE_URL}/sso/callback`,
      redirect_uris: [{ uri: `${INSTANCE_URL}/sso/callback`, host: "instance", verified: true }],
    });
    expect(systemSettings.findUnique).not.toHaveBeenCalled();
  });

  it("gives a null return address while the instance has no address, and still answers", async () => {
    const noAddress = () => Promise.reject(new Error("no instance url"));
    const res = await makeApp(memoryDb().db, noAddress).request("/sso-provider");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirect_uri: null, redirect_uris: [] });
  });
});

describe("the kind of an identity provider, told from its issuer", () => {
  it.each([
    ["https://login.microsoftonline.com/tenant-a/v2.0", "entra"],
    ["https://sts.windows.net/tenant-a/", "entra"],
    ["https://login.windows.net/tenant-a", "entra"],
    ["https://accounts.google.com", "google"],
    ["https://sso.example.com/realms/acme", "generic"],
    ["https://login.microsoftonline.com.evil.example/x", "generic"],
    ["not an address", "generic"],
  ])("tells %s from %s", (issuer, kind) => {
    expect(ssoProviderKind(issuer)).toBe(kind);
  });
});
