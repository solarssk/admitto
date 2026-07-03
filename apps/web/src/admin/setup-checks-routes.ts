import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { canManageInstance, getInstanceUrl } from "@admitto/auth";
import { validateEncryptionKeyBootConfig } from "../config.js";
import { checkMigrationsStatus } from "../ops/migrations-check.js";
import { checkRedis } from "../ops/readyz.js";
import type { RateLimitStore } from "../rate-limit/types.js";
import { normalizePersistedInstanceUrl, normalizeRuntimeBaseUrl } from "../instance-base-url.js";

export type SetupCheckResult = { ok: boolean; detail: string; warn?: boolean };

export type SetupChecksPayload = {
  checks: {
    database: SetupCheckResult;
    redis: SetupCheckResult;
    encryption: SetupCheckResult;
    base_url: SetupCheckResult;
  };
};

/** DB reachability plus Prisma schema parity (migrations run at container boot). */
async function checkDatabaseWithMigrations(db: PrismaClient): Promise<SetupCheckResult> {
  try {
    await db.$queryRaw(Prisma.sql`SELECT 1`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Cannot connect to PostgreSQL";
    return { ok: false, detail };
  }

  const migrationsStatus = await checkMigrationsStatus(db);
  if (migrationsStatus !== "ok") {
    return {
      ok: false,
      detail: "PostgreSQL connected · migrations pending",
    };
  }

  return { ok: true, detail: "PostgreSQL connected · migrations current" };
}

/** Validate ENCRYPTION_KEY boot config (optional in dev/test when unset). */
function checkEncryption(env: NodeJS.ProcessEnv = process.env): SetupCheckResult {
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
    const raw = env.ENCRYPTION_KEY?.trim();
    if (!raw) {
      return { ok: true, detail: "Optional in development (set ENCRYPTION_KEY for production parity)" };
    }
  }
  try {
    validateEncryptionKeyBootConfig(env);
    return { ok: true, detail: "ENCRYPTION_KEY configured (32 bytes)" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Invalid ENCRYPTION_KEY";
    return { ok: false, detail };
  }
}

/** Validate instance URL: injected app URL → env BASE_URL → DB settings. */
async function checkInstanceUrl(
  db: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  injectedBaseUrl?: string,
): Promise<SetupCheckResult> {
  const injected = injectedBaseUrl?.trim();
  if (injected) {
    try {
      const normalized = normalizeRuntimeBaseUrl(injected, env);
      return { ok: true, detail: normalized };
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Invalid instance URL";
      return { ok: false, detail };
    }
  }

  const envRaw = env.BASE_URL?.trim();
  if (envRaw) {
    try {
      const normalized = normalizeRuntimeBaseUrl(envRaw, env);
      return { ok: true, detail: normalized };
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Invalid BASE_URL";
      return { ok: false, detail };
    }
  }

  const dbUrl = await getInstanceUrl(db);
  if (dbUrl) {
    try {
      const normalized = normalizePersistedInstanceUrl(dbUrl);
      if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
        return {
          ok: false,
          detail:
            "BASE_URL env is required for server boot in production; Settings instance URL alone is not sufficient",
        };
      }
      return { ok: true, detail: normalized };
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Invalid instance URL in settings";
      return { ok: false, detail };
    }
  }

  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
    return {
      ok: true,
      warn: true,
      detail: "Instance URL optional in development — set in Settings → General or BASE_URL env",
    };
  }

  return {
    ok: false,
    detail: "Instance URL is required in production (Settings → General or BASE_URL env)",
  };
}

/** Run wizard step-1 system checks (shared by GET checks and POST complete guard). */
export async function collectSetupChecks(
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
  injectedBaseUrl?: string,
): Promise<SetupChecksPayload["checks"]> {
  const database = await checkDatabaseWithMigrations(db);

  const redisProbe = await checkRedis(rateLimitStore);
  const redis: SetupCheckResult =
    redisProbe.status === "degraded"
      ? { ok: false, detail: "Redis unreachable" }
      : redisProbe.status === "disabled"
        ? { ok: true, detail: "In-memory rate limit store (no Redis)" }
        : { ok: true, detail: `Redis OK (${redisProbe.latency_ms ?? 0} ms)` };

  return {
    database,
    redis,
    encryption: checkEncryption(),
    base_url: await checkInstanceUrl(db, process.env, injectedBaseUrl),
  };
}

/** True when every check passed (warnings with `ok: true` are allowed). */
export function setupChecksAllOk(checks: SetupChecksPayload["checks"]): boolean {
  return checks.database.ok && checks.redis.ok && checks.encryption.ok && checks.base_url.ok;
}

/** GET /api/admin/setup/checks — superadmin system readiness for wizard step 1. */
export async function handleGetSetupChecks(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
  injectedBaseUrl?: string,
): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const checks = await collectSetupChecks(db, rateLimitStore, injectedBaseUrl);
  const payload: SetupChecksPayload = { checks };

  return c.json(payload, 200);
}
