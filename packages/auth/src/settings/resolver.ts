import type { PrismaClient, Prisma } from "@prisma/client";
import { SETTING_DEFAULTS, SETTING_ENV_LOCKS } from "./defaults.js";

function parseEnvValue(raw: string, fallback: unknown): unknown {
  const trimmed = raw.trim();
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

export async function getSessionTtlAdminMs(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<number> {
  const v = await getSetting<number>(prisma, "session_ttl");
  return typeof v === "number" && v > 0 ? v : (SETTING_DEFAULTS["session_ttl"] as number);
}

export async function getSessionTtlOperatorMs(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<number> {
  const v = await getSetting<number>(prisma, "operator_session_ttl");
  return typeof v === "number" && v > 0 ? v : (SETTING_DEFAULTS["operator_session_ttl"] as number);
}

export async function getTrustedDeviceDays(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<number> {
  const v = await getSetting<number>(prisma, "trusted_device_days");
  return typeof v === "number" && v > 0 ? v : (SETTING_DEFAULTS["trusted_device_days"] as number);
}

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
