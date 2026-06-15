import type { PrismaClient, Prisma } from "@prisma/client";
import { SETTING_DEFAULTS, SETTING_ENV_LOCKS } from "./defaults.js";

function parseEnvValue(raw: string, fallback: unknown): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed;
    }
  }
  const n = Number(trimmed);
  if (Number.isFinite(n) && trimmed !== "") return n;
  return trimmed;
}

function envOverride(key: string): unknown | undefined {
  const envName = SETTING_ENV_LOCKS[key];
  if (!envName) return undefined;
  const raw = process.env[envName];
  if (raw === undefined || raw === "") return undefined;
  return parseEnvValue(raw, SETTING_DEFAULTS[key]);
}

/** True when an env lock is set for this setting (UI field should be read-only). */
export function isSettingEnvLocked(key: string): boolean {
  return envOverride(key) !== undefined;
}

/** Persist a system setting when not env-locked. */
export async function setSetting(
  prisma: PrismaClient | Prisma.TransactionClient,
  key: string,
  value: unknown,
): Promise<void> {
  if (isSettingEnvLocked(key)) {
    throw new Error(`setting_locked_by_env:${key}`);
  }
  const value_json = JSON.stringify(value);
  await prisma.systemSettings.upsert({
    where: { key },
    create: { key, value_json },
    update: { value_json },
  });
}

/**
 * Resolve a system setting: env lock → DB → built-in default.
 * `value_json` in DB is stored as JSON text (number or string).
 */
export async function getSetting<T = unknown>(
  prisma: PrismaClient | Prisma.TransactionClient,
  key: string,
): Promise<T> {
  const fromEnv = envOverride(key);
  if (fromEnv !== undefined) return fromEnv as T;

  const row = await prisma.systemSettings.findUnique({ where: { key } });
  if (row) {
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return row.value_json as T;
    }
  }

  return SETTING_DEFAULTS[key] as T;
}

/** Admin/superadmin session TTL in ms from SystemSettings (`session_ttl`). */
export async function getSessionTtlAdminMs(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<number> {
  const v = await getSetting<number>(prisma, "session_ttl");
  return typeof v === "number" && v > 0 ? v : (SETTING_DEFAULTS["session_ttl"] as number);
}

/** Operator session TTL in ms from SystemSettings (`operator_session_ttl`). */
export async function getSessionTtlOperatorMs(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<number> {
  const v = await getSetting<number>(prisma, "operator_session_ttl");
  return typeof v === "number" && v > 0 ? v : (SETTING_DEFAULTS["operator_session_ttl"] as number);
}

/** Trusted-device cookie lifetime in days from SystemSettings (`trusted_device_days`). */
export async function getTrustedDeviceDays(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<number> {
  const v = await getSetting<number>(prisma, "trusted_device_days");
  return typeof v === "number" && v > 0 ? v : (SETTING_DEFAULTS["trusted_device_days"] as number);
}

/** Role names that require MFA (from SystemSettings `mfa_required_roles`, JSON array or CSV). */
export async function getMfaRequiredRoles(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<string[]> {
  const v = await getSetting<string | string[]>(prisma, "mfa_required_roles");
  if (Array.isArray(v)) {
    return v.map((r) => String(r).trim()).filter(Boolean);
  }
  const csv =
    typeof v === "string" ? v : (SETTING_DEFAULTS["mfa_required_roles"] as string);
  return csv
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}
