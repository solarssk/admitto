import { describe, expect, it, vi } from "vitest";
import { decryptFromString, encryptToString, SECRET_CONTEXTS } from "@admitto/crypto";
import {
  TURNSTILE_SETTINGS_KEY,
  clearTurnstileSettings,
  describeTurnstileSettings,
  isValidTurnstileSecretKey,
  isValidTurnstileSiteKey,
  patchTurnstileSettings,
  resolveTurnstileKeys,
  type TurnstileSettingsDb,
} from "../src/registration/turnstile-settings.js";
import { memorySystemSettings } from "./helpers/memory-system-settings.js";

const SITE_KEY = "0x4AAAAAAAexampleSite_key-1";
const SECRET = "0x4AAAAAAAexampleSecret_key-2";

/** The settings table in memory, with an optional stored value for the Turnstile key. */
function memoryDb(initial?: string) {
  const memory = memorySystemSettings(initial === undefined ? {} : { [TURNSTILE_SETTINGS_KEY]: initial });
  return {
    db: { systemSettings: memory.systemSettings } as unknown as TurnstileSettingsDb,
    rows: memory.rows,
    systemSettings: memory.systemSettings,
  };
}

describe("isValidTurnstileSiteKey / isValidTurnstileSecretKey", () => {
  it("accept what Cloudflare issues", () => {
    expect(isValidTurnstileSiteKey("1x00000000000000000000AA")).toBe(true);
    expect(isValidTurnstileSiteKey(SITE_KEY)).toBe(true);
    expect(isValidTurnstileSecretKey("1x0000000000000000000000000000000AA")).toBe(true);
    expect(isValidTurnstileSecretKey(SECRET)).toBe(true);
  });

  it("refuse anything that could break out of an HTML attribute or a script, and anything with spaces", () => {
    for (const bad of ["", "a b", "a\"b", "a'b", "a<b", "a>b", "a;b", "a\nb", "a`b", "a${b}", "ą", "a".repeat(129)]) {
      expect(isValidTurnstileSiteKey(bad)).toBe(false);
    }
    for (const bad of ["", "a b", " a", "a ", "a\nb", "a\tb", "ą", "a".repeat(513)]) {
      expect(isValidTurnstileSecretKey(bad)).toBe(false);
    }
  });
});

describe("Turnstile settings storage", () => {
  it("starts with nothing saved, which is closed", async () => {
    const { db } = memoryDb();
    expect(await describeTurnstileSettings(db)).toEqual({ siteKey: null, secretSet: false, state: "incomplete" });
    expect(await resolveTurnstileKeys(db)).toEqual({ state: "incomplete" });
  });

  it("saves both keys and reads them back as ready", async () => {
    const { db } = memoryDb();
    const saved = await patchTurnstileSettings(db, { siteKey: SITE_KEY, secretKey: SECRET });
    expect(saved).toEqual({ siteKey: SITE_KEY, secretSet: true, state: "ready" });
    expect(await resolveTurnstileKeys(db)).toEqual({ state: "ready", siteKey: SITE_KEY, secret: SECRET });
  });

  it("stores the secret as ciphertext bound to its own purpose, never in clear", async () => {
    const { db, rows } = memoryDb();
    await patchTurnstileSettings(db, { siteKey: SITE_KEY, secretKey: SECRET });
    const stored = rows().get(TURNSTILE_SETTINGS_KEY)!;
    expect(stored).not.toContain(SECRET);
    const { secretEnc } = JSON.parse(stored) as { siteKey: string; secretEnc: string };
    expect(JSON.parse(secretEnc)).toMatchObject({ keyVersion: 2 });
    expect(decryptFromString(secretEnc, SECRET_CONTEXTS.turnstileSecret)).toBe(SECRET);
    // Copied into a column with another purpose, it does not decrypt.
    expect(() => decryptFromString(secretEnc, SECRET_CONTEXTS.walletApiKey)).toThrow();
    expect(() => decryptFromString(secretEnc)).toThrow();
  });

  it("keeps the other key when only one is sent", async () => {
    const { db } = memoryDb();
    await patchTurnstileSettings(db, { siteKey: SITE_KEY, secretKey: SECRET });
    await patchTurnstileSettings(db, { siteKey: "0x4AAAAAAAnewSite" });
    expect(await resolveTurnstileKeys(db)).toEqual({ state: "ready", siteKey: "0x4AAAAAAAnewSite", secret: SECRET });
    await patchTurnstileSettings(db, { secretKey: "newSecretValue" });
    expect(await resolveTurnstileKeys(db)).toEqual({ state: "ready", siteKey: "0x4AAAAAAAnewSite", secret: "newSecretValue" });
  });

  it("clears one key with null and leaves the form closed", async () => {
    const { db } = memoryDb();
    await patchTurnstileSettings(db, { siteKey: SITE_KEY, secretKey: SECRET });
    expect(await patchTurnstileSettings(db, { secretKey: null })).toEqual({
      siteKey: SITE_KEY,
      secretSet: false,
      state: "incomplete",
    });
    await patchTurnstileSettings(db, { secretKey: SECRET });
    expect(await patchTurnstileSettings(db, { siteKey: null })).toEqual({ siteKey: null, secretSet: true, state: "incomplete" });
    expect((await resolveTurnstileKeys(db)).state).toBe("incomplete");
  });

  it("refuses a malformed key and writes nothing", async () => {
    const { db, systemSettings } = memoryDb();
    await expect(patchTurnstileSettings(db, { siteKey: "bad key" })).rejects.toThrow(TypeError);
    await expect(patchTurnstileSettings(db, { secretKey: "bad secret" })).rejects.toThrow(TypeError);
    await expect(patchTurnstileSettings(db, { siteKey: SITE_KEY, secretKey: "" })).rejects.toThrow(TypeError);
    expect(systemSettings.upsert).not.toHaveBeenCalled();
  });

  it("removes both keys, and is safe when none are saved", async () => {
    const { db, rows } = memoryDb();
    await clearTurnstileSettings(db);
    await patchTurnstileSettings(db, { siteKey: SITE_KEY, secretKey: SECRET });
    await clearTurnstileSettings(db);
    expect(rows().has(TURNSTILE_SETTINGS_KEY)).toBe(false);
    expect((await resolveTurnstileKeys(db)).state).toBe("incomplete");
  });

  it("never puts the secret into what the screen and the Health row read", async () => {
    const { db } = memoryDb();
    const saved = await patchTurnstileSettings(db, { siteKey: SITE_KEY, secretKey: SECRET });
    expect(JSON.stringify(saved)).not.toContain(SECRET);
    expect(JSON.stringify(await describeTurnstileSettings(db))).not.toContain(SECRET);
  });
});

describe("what a stored value allows", () => {
  const enc = (secret: string, context: string = SECRET_CONTEXTS.turnstileSecret) => encryptToString(secret, context);

  it("is unreadable, not ready, when the secret does not decrypt as this purpose", async () => {
    for (const secretEnc of [enc(SECRET, "another-purpose"), "plain text secret", "{}"]) {
      const { db } = memoryDb(JSON.stringify({ siteKey: SITE_KEY, secretEnc }));
      expect(await describeTurnstileSettings(db)).toEqual({ siteKey: SITE_KEY, secretSet: true, state: "unreadable" });
      expect(await resolveTurnstileKeys(db)).toEqual({ state: "unreadable" });
    }
  });

  it("does not accept a legacy value, written without a context, even though it decrypts", async () => {
    // packages/crypto reads keyVersion 1 under any context, so without this check a ciphertext of
    // another purpose (the weather API key is one) would work as the Turnstile secret.
    const legacy = encryptToString(SECRET);
    expect(decryptFromString(legacy, SECRET_CONTEXTS.turnstileSecret)).toBe(SECRET);
    const { db } = memoryDb(JSON.stringify({ siteKey: SITE_KEY, secretEnc: legacy }));
    expect(await describeTurnstileSettings(db)).toEqual({ siteKey: SITE_KEY, secretSet: true, state: "unreadable" });
    expect(await resolveTurnstileKeys(db)).toEqual({ state: "unreadable" });
  });

  it("is incomplete when the secret decrypts to something no secret can be", async () => {
    const { db } = memoryDb(JSON.stringify({ siteKey: SITE_KEY, secretEnc: enc("has a space") }));
    expect((await resolveTurnstileKeys(db)).state).toBe("incomplete");
  });

  it("ignores a site key that could not have been saved through the screen", async () => {
    const markup = '"><script>alert(1)</script>';
    const { db } = memoryDb(JSON.stringify({ siteKey: markup, secretEnc: enc(SECRET) }));
    expect(await describeTurnstileSettings(db)).toEqual({ siteKey: null, secretSet: true, state: "incomplete" });
    expect(await resolveTurnstileKeys(db)).toEqual({ state: "incomplete" });
  });

  it("reads a corrupt or foreign value as no keys", async () => {
    for (const value of ["not json", "null", "[]", "\"x\"", "42", JSON.stringify({ siteKey: 5, secretEnc: 6 })]) {
      const { db } = memoryDb(value);
      expect(await describeTurnstileSettings(db)).toEqual({ siteKey: null, secretSet: false, state: "incomplete" });
    }
  });

  it("lets a database error through instead of reading it as no keys", async () => {
    const failing = {
      systemSettings: {
        findUnique: vi.fn(async () => {
          throw new Error("connection lost");
        }),
      },
    } as unknown as TurnstileSettingsDb;
    await expect(resolveTurnstileKeys(failing)).rejects.toThrow("connection lost");
  });
});
