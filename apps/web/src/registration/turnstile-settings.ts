/**
 * The Cloudflare Turnstile keys of the public registration form (D-C2), kept in SystemSettings
 * like the weather and maps settings: one JSON value, the secret encrypted inside it.
 *
 * Only a superadmin sets them (D-A6). Without both keys the registration form is closed: there is
 * no development exception and no "let it through" default, because the challenge is the only bot
 * defence on a page that mails unverified addresses.
 */

import { decryptFromString, encryptToString, SECRET_CONTEXTS } from "@admitto/crypto";
import type { PrismaClient } from "@admitto/db";

/**
 * SystemSettings.key of the JSON `{ siteKey, secretEnc }`. Deliberately not in
 * `SYSTEM_SETTING_KEYS`: the generic system settings API must never be able to carry it.
 */
export const TURNSTILE_SETTINGS_KEY = "registration_turnstile";

export type TurnstileSettingsDb = Pick<PrismaClient, "systemSettings">;

/** The site key is public and lands in the registration page, so it is held to a strict shape
 * (Cloudflare issues letters, digits, `_` and `-`). One rule for saving it and for reading it back,
 * so a hand-edited row can never put anything else into a page. */
const SITE_KEY_PATTERN = /^[0-9A-Za-z_-]{1,128}$/;
/** Printable ASCII, no whitespace: a pasted newline or space is a typing error, not part of a key. */
const SECRET_KEY_PATTERN = /^[\x21-\x7E]{1,512}$/;

export function isValidTurnstileSiteKey(value: string): boolean {
  return SITE_KEY_PATTERN.test(value);
}

export function isValidTurnstileSecretKey(value: string): boolean {
  return SECRET_KEY_PATTERN.test(value);
}

interface StoredTurnstile {
  siteKey: string | null;
  secretEnc: string | null;
}

/**
 * What the keys allow right now.
 * - `ready`: both keys are saved and the secret decrypts.
 * - `incomplete`: the site key or the secret is not saved.
 * - `unreadable`: a secret is saved but cannot be decrypted (the ENCRYPTION_KEY changed).
 */
export type TurnstileKeys =
  | { state: "ready"; siteKey: string; secret: string }
  | { state: "incomplete" }
  | { state: "unreadable" };

export type TurnstileKeyState = TurnstileKeys["state"];

export interface TurnstileSettingsPublic {
  siteKey: string | null;
  /** True when a secret is saved, whether or not it can be read. The secret itself never leaves. */
  secretSet: boolean;
  state: TurnstileKeyState;
}

const EMPTY: StoredTurnstile = { siteKey: null, secretEnc: null };

/** Throws when the query fails. A missing or corrupt row reads as "no keys". */
async function readStored(db: TurnstileSettingsDb): Promise<StoredTurnstile> {
  const row = await db.systemSettings.findUnique({ where: { key: TURNSTILE_SETTINGS_KEY } });
  if (!row) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(row.value_json);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return EMPTY;
    const { siteKey, secretEnc } = parsed as Record<string, unknown>;
    return {
      siteKey: typeof siteKey === "string" && isValidTurnstileSiteKey(siteKey) ? siteKey : null,
      secretEnc: typeof secretEnc === "string" && secretEnc !== "" ? secretEnc : null,
    };
  } catch {
    return EMPTY;
  }
}

/** `keyVersion` that `encrypt` writes when it is given a context (packages/crypto/src/encrypt.ts). */
const CONTEXT_BOUND_KEY_VERSION = 2;

/**
 * packages/crypto reads a legacy value (keyVersion 1, no context) under any context, so a ciphertext
 * of another purpose copied here would pass for this secret. This secret is always written with its
 * own context, so only a value that carries one counts.
 */
function isBoundToContext(secretEnc: string): boolean {
  try {
    return (JSON.parse(secretEnc) as { keyVersion?: unknown }).keyVersion === CONTEXT_BOUND_KEY_VERSION;
  } catch {
    return false;
  }
}

function keysFromStored(stored: StoredTurnstile): TurnstileKeys {
  if (stored.siteKey === null || stored.secretEnc === null) return { state: "incomplete" };
  if (!isBoundToContext(stored.secretEnc)) return { state: "unreadable" };
  try {
    const secret = decryptFromString(stored.secretEnc, SECRET_CONTEXTS.turnstileSecret);
    return isValidTurnstileSecretKey(secret)
      ? { state: "ready", siteKey: stored.siteKey, secret }
      : { state: "incomplete" };
  } catch {
    return { state: "unreadable" };
  }
}

/** The keys as the verifier and the registration page use them. */
export async function resolveTurnstileKeys(db: TurnstileSettingsDb): Promise<TurnstileKeys> {
  return keysFromStored(await readStored(db));
}

function publicFrom(stored: StoredTurnstile): TurnstileSettingsPublic {
  return {
    siteKey: stored.siteKey,
    secretSet: stored.secretEnc !== null,
    state: keysFromStored(stored).state,
  };
}

/** What the superadmin screen and the Health row show: the site key (public) and whether a secret
 * is saved, never the secret. */
export async function describeTurnstileSettings(db: TurnstileSettingsDb): Promise<TurnstileSettingsPublic> {
  return publicFrom(await readStored(db));
}

/** `undefined` keeps a value, `null` clears it, a string replaces it. Values are checked by the
 * caller with `isValidTurnstileSiteKey` / `isValidTurnstileSecretKey`; they are checked again here
 * because this is the one place that writes them. */
export interface TurnstileSettingsPatch {
  siteKey?: string | null;
  secretKey?: string | null;
}

function nextSecretEnc(current: string | null, secretKey: string | null | undefined): string | null {
  if (secretKey === undefined) return current;
  if (secretKey === null) return null;
  return encryptToString(secretKey, SECRET_CONTEXTS.turnstileSecret);
}

export async function patchTurnstileSettings(
  db: TurnstileSettingsDb,
  patch: TurnstileSettingsPatch,
): Promise<TurnstileSettingsPublic> {
  if (typeof patch.siteKey === "string" && !isValidTurnstileSiteKey(patch.siteKey)) {
    throw new TypeError("invalid Turnstile site key");
  }
  if (typeof patch.secretKey === "string" && !isValidTurnstileSecretKey(patch.secretKey)) {
    throw new TypeError("invalid Turnstile secret key");
  }
  const current = await readStored(db);
  const next: StoredTurnstile = {
    siteKey: patch.siteKey === undefined ? current.siteKey : patch.siteKey,
    secretEnc: nextSecretEnc(current.secretEnc, patch.secretKey),
  };
  const value_json = JSON.stringify(next);
  await db.systemSettings.upsert({
    where: { key: TURNSTILE_SETTINGS_KEY },
    create: { key: TURNSTILE_SETTINGS_KEY, value_json },
    update: { value_json },
  });
  return publicFrom(next);
}

/** Removes both keys. Safe when none are saved. */
export async function clearTurnstileSettings(db: TurnstileSettingsDb): Promise<void> {
  await db.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });
}
