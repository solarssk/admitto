import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { canManageInstance } from "@admitto/auth";
import { validateEncryptionKeyBootConfig } from "../config.js";
import { checkMigrationsStatus } from "../ops/migrations-check.js";
import { checkRedis } from "../ops/readyz.js";
import type { RateLimitStore } from "../rate-limit/types.js";

export type SetupCheckResult = { ok: boolean; detail: string };

export type SetupChecksPayload = {
  checks: {
    database: SetupCheckResult;
    migrations: SetupCheckResult;
    redis: SetupCheckResult;
    encryption: SetupCheckResult;
    base_url: SetupCheckResult;
  };
};

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

function checkBaseUrl(env: NodeJS.ProcessEnv = process.env): SetupCheckResult {
  const raw = env.BASE_URL?.trim();
  if (!raw) {
    if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
      return { ok: true, detail: "BASE_URL optional in development" };
    }
    return { ok: false, detail: "BASE_URL is required in production" };
  }
  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test" && !raw.startsWith("https://")) {
    return { ok: false, detail: "BASE_URL must use https:// in production" };
  }
  return { ok: true, detail: raw };
}

/** GET /api/admin/setup/checks — superadmin system readiness for wizard step 1. */
export async function handleGetSetupChecks(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  let database: SetupCheckResult;
  try {
    await db.$queryRaw(Prisma.sql`SELECT 1`);
    database = { ok: true, detail: "Connected" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Database unreachable";
    database = { ok: false, detail };
  }

  const migrationsStatus = await checkMigrationsStatus(db);
  const migrations: SetupCheckResult =
    migrationsStatus === "ok"
      ? { ok: true, detail: "All migrations applied" }
      : { ok: false, detail: "Pending or failed migrations — run prisma migrate deploy" };

  const redisProbe = await checkRedis(rateLimitStore);
  const redis: SetupCheckResult =
    redisProbe.status === "degraded"
      ? { ok: false, detail: "Redis unreachable" }
      : redisProbe.status === "disabled"
        ? { ok: true, detail: "In-memory rate limit store (no Redis)" }
        : { ok: true, detail: `Redis OK (${redisProbe.latency_ms ?? 0} ms)` };

  const payload: SetupChecksPayload = {
    checks: {
      database,
      migrations,
      redis,
      encryption: checkEncryption(),
      base_url: checkBaseUrl(),
    },
  };

  return c.json(payload, 200);
}
