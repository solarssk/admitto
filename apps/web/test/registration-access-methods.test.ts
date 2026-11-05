import { describe, expect, it, vi } from "vitest";
import { encryptToString, SECRET_CONTEXTS } from "@admitto/crypto";
import type { Prisma, PrismaClient } from "@admitto/db";
import {
  ACCESS_METHODS_SETTINGS_KEY,
  computeAccessMethodAvailability,
  getEnabledAccessMethods,
  resolveAccessMethodAvailability,
  setEnabledAccessMethods,
} from "../src/registration/access-methods.js";
import { SSO_PROVIDER_SETTINGS_KEY } from "../src/registration/sso-provider.js";
import { TURNSTILE_SETTINGS_KEY } from "../src/registration/turnstile-settings.js";
import { memorySystemSettings } from "./helpers/memory-system-settings.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** SystemSettings in memory plus an identity provider table with the given rows (found by id, as `findOidcProviderById` asks). */
function fakeDb(options: { values?: Record<string, string>; providers?: { id: string; enabled: boolean }[] } = {}) {
  const memory = memorySystemSettings(options.values);
  const findFirst = vi.fn(async ({ where }: { where: { id: string; provider_type: string } }) =>
    (options.providers ?? []).find((provider) => provider.id === where.id) ?? null,
  );
  const db = { systemSettings: memory.systemSettings, identityProvider: { findFirst } } as unknown as Db;
  return { db, rows: memory.rows(), findFirst };
}

const readyKeys = JSON.stringify({
  siteKey: "0x4AAAAAAAsite",
  secretEnc: encryptToString("0x4AAAAAAAsecret", SECRET_CONTEXTS.turnstileSecret),
});

describe("enabled access methods", () => {
  it("are empty until a superadmin decides", async () => {
    expect(await getEnabledAccessMethods(fakeDb().db)).toEqual([]);
  });

  it("are read back in the canonical order, once each", async () => {
    const { db, rows } = fakeDb();
    expect(await setEnabledAccessMethods(db, ["sso", "link", "sso", "link"])).toEqual(["link", "sso"]);
    expect(rows.get(ACCESS_METHODS_SETTINGS_KEY)).toBe('["link","sso"]');
    expect(await getEnabledAccessMethods(db)).toEqual(["link", "sso"]);
  });

  it("drop names that are not methods, and turn all off with an empty list", async () => {
    const { db } = fakeDb();
    expect(await setEnabledAccessMethods(db, ["link", "email", "__proto__", "Password"])).toEqual(["link"]);
    expect(await setEnabledAccessMethods(db, [])).toEqual([]);
    expect(await getEnabledAccessMethods(db)).toEqual([]);
  });

  it("read a corrupt or foreign value as nothing enabled", async () => {
    for (const value of ["not json", "null", "{}", "\"link\"", "42", '{"link":true}']) {
      expect(await getEnabledAccessMethods(fakeDb({ values: { [ACCESS_METHODS_SETTINGS_KEY]: value } }).db)).toEqual([]);
    }
  });

  it("ignore unknown names in a stored list", async () => {
    const value = '["password","bogus",7,null,"link","link"]';
    expect(await getEnabledAccessMethods(fakeDb({ values: { [ACCESS_METHODS_SETTINGS_KEY]: value } }).db)).toEqual([
      "link",
      "password",
    ]);
  });
});

describe("computeAccessMethodAvailability", () => {
  const compute = (enabled: Array<"link" | "password" | "sso">, botProtectionReady: boolean, identityProviderEnabled: boolean) =>
    computeAccessMethodAvailability({ enabled, botProtectionReady, identityProviderEnabled });

  it("lists every method in a fixed order", () => {
    expect(compute([], false, false).map((entry) => entry.method)).toEqual(["link", "password", "sso"]);
  });

  it("makes nothing available by default, and blocks nothing that was not enabled", () => {
    for (const entry of compute([], true, true)) {
      expect(entry).toMatchObject({ enabled: false, available: false, blockedBy: null });
    }
  });

  it("needs bot protection for the link and for the password, not for SSO", () => {
    const all = ["link", "password", "sso"] as const;
    expect(compute([...all], false, true)).toEqual([
      { method: "link", enabled: true, available: false, blockedBy: "bot_protection" },
      { method: "password", enabled: true, available: false, blockedBy: "bot_protection" },
      { method: "sso", enabled: true, available: true, blockedBy: null },
    ]);
  });

  it("needs an enabled identity provider for SSO, not for the link or the password", () => {
    const all = ["link", "password", "sso"] as const;
    expect(compute([...all], true, false)).toEqual([
      { method: "link", enabled: true, available: true, blockedBy: null },
      { method: "password", enabled: true, available: true, blockedBy: null },
      { method: "sso", enabled: true, available: false, blockedBy: "identity_provider" },
    ]);
  });

  it("makes only the enabled methods available", () => {
    expect(compute(["password"], true, true).map((entry) => entry.available)).toEqual([false, true, false]);
  });
});

describe("resolveAccessMethodAvailability", () => {
  const byMethod = (list: Awaited<ReturnType<typeof resolveAccessMethodAvailability>>) =>
    Object.fromEntries(list.map((entry) => [entry.method, entry.available]));

  it("closes link and password without keys, also for a development-looking setup", async () => {
    const values = { [ACCESS_METHODS_SETTINGS_KEY]: '["link","password","sso"]' };
    const { db } = fakeDb({ values });
    expect(byMethod(await resolveAccessMethodAvailability(db))).toEqual({ link: false, password: false, sso: false });
  });

  it("opens link and password once the keys are saved and readable", async () => {
    const values = { [ACCESS_METHODS_SETTINGS_KEY]: '["link","password"]', [TURNSTILE_SETTINGS_KEY]: readyKeys };
    expect(byMethod(await resolveAccessMethodAvailability(fakeDb({ values }).db))).toEqual({
      link: true,
      password: true,
      sso: false,
    });
  });

  it("keeps link and password closed when the saved secret cannot be read", async () => {
    const unreadable = JSON.stringify({ siteKey: "0x4AAAAAAAsite", secretEnc: encryptToString("s", "another-purpose") });
    const values = { [ACCESS_METHODS_SETTINGS_KEY]: '["link"]', [TURNSTILE_SETTINGS_KEY]: unreadable };
    expect(byMethod(await resolveAccessMethodAvailability(fakeDb({ values }).db))).toEqual({
      link: false,
      password: false,
      sso: false,
    });
  });

  it("opens SSO when the identity provider chosen for guests exists and is enabled, with no Turnstile keys", async () => {
    const values = { [ACCESS_METHODS_SETTINGS_KEY]: '["sso"]', [SSO_PROVIDER_SETTINGS_KEY]: '"idp-1"' };
    const providers = [{ id: "idp-1", enabled: true }];
    expect(byMethod(await resolveAccessMethodAvailability(fakeDb({ values, providers }).db))).toEqual({
      link: false,
      password: false,
      sso: true,
    });
  });

  it("keeps SSO closed, and says why, while no provider is chosen, the chosen one is gone or switched off, or another one is enabled", async () => {
    const enabled = { [ACCESS_METHODS_SETTINGS_KEY]: '["sso"]' };
    const cases: [string, Parameters<typeof fakeDb>[0]][] = [
      ["nothing chosen, one enabled", { values: enabled, providers: [{ id: "idp-1", enabled: true }] }],
      ["chosen provider deleted", { values: { ...enabled, [SSO_PROVIDER_SETTINGS_KEY]: '"idp-gone"' }, providers: [{ id: "idp-1", enabled: true }] }],
      ["chosen provider switched off", { values: { ...enabled, [SSO_PROVIDER_SETTINGS_KEY]: '"idp-1"' }, providers: [{ id: "idp-1", enabled: false }] }],
      ["chosen value is not an id", { values: { ...enabled, [SSO_PROVIDER_SETTINGS_KEY]: "7" }, providers: [{ id: "idp-1", enabled: true }] }],
      ["chosen value is corrupt", { values: { ...enabled, [SSO_PROVIDER_SETTINGS_KEY]: "not json" }, providers: [{ id: "idp-1", enabled: true }] }],
    ];
    for (const [what, options] of cases) {
      const list = await resolveAccessMethodAvailability(fakeDb(options).db);
      expect(list.find((entry) => entry.method === "sso"), what).toEqual({
        method: "sso",
        enabled: true,
        available: false,
        blockedBy: "identity_provider",
      });
    }
  });

  it("looks for the chosen provider by its id, among the OIDC providers, and for nothing when none is chosen", async () => {
    const chosen = fakeDb({ values: { [SSO_PROVIDER_SETTINGS_KEY]: '"idp-1"' } });
    await resolveAccessMethodAvailability(chosen.db);
    expect(chosen.findFirst).toHaveBeenCalledTimes(1);
    expect(chosen.findFirst).toHaveBeenCalledWith({ where: { id: "idp-1", provider_type: "oidc" } });

    const none = fakeDb();
    await resolveAccessMethodAvailability(none.db);
    expect(none.findFirst).not.toHaveBeenCalled();
  });
});
