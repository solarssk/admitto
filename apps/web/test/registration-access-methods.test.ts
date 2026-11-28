import { describe, expect, it, vi } from "vitest";
import { encryptToString, SECRET_CONTEXTS } from "@admitto/crypto";
import type { Prisma, PrismaClient } from "@admitto/db";
import { computeAccessMethodAvailability, resolveAccessMethodAvailability } from "../src/registration/access-methods.js";
import { BOT_PROTECTION_SETTINGS_KEY } from "../src/registration/bot-protection-mode.js";
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

describe("computeAccessMethodAvailability", () => {
  const compute = (botProtectionReady: boolean) => computeAccessMethodAvailability({ botProtectionReady });

  it("lists every method in a fixed order", () => {
    expect(compute(false).map((entry) => entry.method)).toEqual(["link", "password", "sso"]);
  });

  it("needs bot protection for the link and for the password, not for SSO", () => {
    expect(compute(false)).toEqual([
      { method: "link", available: false, blockedBy: "bot_protection" },
      { method: "password", available: false, blockedBy: "bot_protection" },
      { method: "sso", available: true, blockedBy: null },
    ]);
  });

  it("offers all three, blocking nothing, once bot protection is ready: nobody turns a way on or off for the organisation", () => {
    expect(compute(true)).toEqual([
      { method: "link", available: true, blockedBy: null },
      { method: "password", available: true, blockedBy: null },
      { method: "sso", available: true, blockedBy: null },
    ]);
  });
});

describe("resolveAccessMethodAvailability", () => {
  const byMethod = (list: Awaited<ReturnType<typeof resolveAccessMethodAvailability>>) =>
    Object.fromEntries(list.map((entry) => [entry.method, entry.available]));

  it("closes link and password without keys, also for a development-looking setup", async () => {
    const { db } = fakeDb();
    expect(byMethod(await resolveAccessMethodAvailability(db))).toEqual({ link: false, password: false, sso: true });
  });

  it("opens link and password once the keys are saved and readable", async () => {
    const values = { [TURNSTILE_SETTINGS_KEY]: readyKeys };
    expect(byMethod(await resolveAccessMethodAvailability(fakeDb({ values }).db))).toEqual({
      link: true,
      password: true,
      sso: true,
    });
  });

  it("opens link and password with no keys at all when the superadmin set bot protection to not used", async () => {
    const values = { [BOT_PROTECTION_SETTINGS_KEY]: '"not_used"' };
    expect(byMethod(await resolveAccessMethodAvailability(fakeDb({ values }).db))).toEqual({
      link: true,
      password: true,
      sso: true,
    });
  });

  it("keeps requiring the keys for a mode that is missing, corrupt or unknown", async () => {
    for (const mode of [undefined, "not json", '"off"', "null", "true", '{"mode":"not_used"}', '"NOT_USED"']) {
      const values: Record<string, string> = mode === undefined ? {} : { [BOT_PROTECTION_SETTINGS_KEY]: mode };
      expect(byMethod(await resolveAccessMethodAvailability(fakeDb({ values }).db)), String(mode)).toEqual({
        link: false,
        password: false,
        sso: true,
      });
    }
  });

  it("opens link and password with no keys at all for an event that switched its own bot protection off, and not for the others", async () => {
    expect(byMethod(await resolveAccessMethodAvailability(fakeDb().db, false))).toEqual({ link: true, password: true, sso: true });
    expect(byMethod(await resolveAccessMethodAvailability(fakeDb().db, true))).toEqual({ link: false, password: false, sso: true });
    // With no argument the event's switch is on, as it is by default.
    expect(byMethod(await resolveAccessMethodAvailability(fakeDb().db))).toEqual({ link: false, password: false, sso: true });
  });

  it("keeps link and password closed when the saved secret cannot be read", async () => {
    const unreadable = JSON.stringify({ siteKey: "0x4AAAAAAAsite", secretEnc: encryptToString("s", "another-purpose") });
    const values = { [TURNSTILE_SETTINGS_KEY]: unreadable };
    expect(byMethod(await resolveAccessMethodAvailability(fakeDb({ values }).db))).toEqual({
      link: false,
      password: false,
      sso: true,
    });
  });

  it("opens SSO with no setting at all, no Turnstile keys and no provider chosen for the instance", async () => {
    const { db, findFirst } = fakeDb();
    expect(byMethod(await resolveAccessMethodAvailability(db))).toEqual({ link: false, password: false, sso: true });
    // The provider is the event's: nothing here looks for one.
    expect(findFirst).not.toHaveBeenCalled();
  });
});
