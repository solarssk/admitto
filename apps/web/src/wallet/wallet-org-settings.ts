/**
 * Org-level wallet (PassCreator) API key, stored in SystemSettings (ADR 0041).
 * Mirrors weather-org-settings.ts. Precedence: UI row (when present) > PASSCREATOR_API_KEY env var.
 */
import type { PrismaClient } from "@admitto/db";
import { decryptFromString, encryptToString } from "@admitto/crypto";

/** Env fallback, read independently of resolvePassCreatorConfig() (config.ts) - that helper also
 * requires PASSCREATOR_TEMPLATE_ID, which a deployment using this per-event template field
 * instead of the legacy combined env config may not have set. */
function envApiKey(env: Record<string, string | undefined>): string | null {
  return env["PASSCREATOR_API_KEY"]?.trim() || null;
}

/** SystemSettings.key - JSON blob, not registered in SETTING_ENV_LOCKS. */
export const WALLET_SETTINGS_KEY = "wallet_settings";

export interface WalletSettingsStored {
  /** Encrypted API key; null clears; omit keeps previous on patch. */
  apiKeyEnc?: string | null;
}

export interface WalletSettingsPublic {
  apiKey: { configured: boolean; source: "organization" | "env" | "none" };
}

function parseStored(raw: unknown): WalletSettingsStored | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: WalletSettingsStored = {};
  if (o.apiKeyEnc === null) out.apiKeyEnc = null;
  else if (typeof o.apiKeyEnc === "string") out.apiKeyEnc = o.apiKeyEnc;
  return out;
}

async function readStored(db: PrismaClient): Promise<WalletSettingsStored | null> {
  const row = await db.systemSettings.findUnique({ where: { key: WALLET_SETTINGS_KEY } });
  if (!row) return null;
  try {
    return parseStored(JSON.parse(row.value_json) as unknown);
  } catch {
    return null;
  }
}

/** Resolved API key: stored (UI) > PASSCREATOR_API_KEY env var > null (unconfigured). */
export async function resolveWalletApiKey(
  db: PrismaClient,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const stored = await readStored(db);
  if (stored?.apiKeyEnc) {
    try {
      return decryptFromString(stored.apiKeyEnc);
    } catch {
      return null;
    }
  }
  return envApiKey(env);
}

export async function describeWalletSettings(
  db: PrismaClient,
  env: Record<string, string | undefined> = process.env,
): Promise<WalletSettingsPublic> {
  const stored = await readStored(db);
  if (stored?.apiKeyEnc) {
    return { apiKey: { configured: true, source: "organization" } };
  }
  if (envApiKey(env)) {
    return { apiKey: { configured: true, source: "env" } };
  }
  return { apiKey: { configured: false, source: "none" } };
}

export interface WalletSettingsPatch {
  /** Omit to keep; empty string clears the organisation key. */
  apiKey?: string | null;
}

export async function patchWalletSettings(
  db: PrismaClient,
  patch: WalletSettingsPatch,
): Promise<WalletSettingsPublic> {
  const current = (await readStored(db)) ?? {};
  const next: WalletSettingsStored = { ...current };

  if (patch.apiKey !== undefined) {
    if (patch.apiKey == null || patch.apiKey.trim() === "") {
      next.apiKeyEnc = null;
    } else {
      next.apiKeyEnc = encryptToString(patch.apiKey.trim());
    }
  }

  await db.systemSettings.upsert({
    where: { key: WALLET_SETTINGS_KEY },
    create: { key: WALLET_SETTINGS_KEY, value_json: JSON.stringify(next) },
    update: { value_json: JSON.stringify(next) },
  });

  return describeWalletSettings(db);
}
