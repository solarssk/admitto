import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { Prisma } from "@admitto/db";
import { canManageInstance, getInstanceUrl } from "@admitto/auth";
import { validateEncryptionKeyBootConfig } from "../config.js";
import { checkMigrationsStatus } from "../ops/migrations-check.js";
import { checkRedis } from "../ops/readyz.js";
import type { RateLimitStore } from "../rate-limit/types.js";
import { normalizePersistedInstanceUrl, normalizeRuntimeBaseUrl } from "../instance-base-url.js";
import { checkWorkerHeartbeat } from "./worker-heartbeat.js";

/** `reason` distinguishes *why* a check is down, currently only set by the database check
 * — a connection failure and "connected but can't confirm migrations are current" are both
 * `ok: false`, but they're not the same problem, and the topbar shouldn't call the latter
 * "not reachable" (see SystemStatus.tsx's PLAIN_DETAIL). */
export type SetupCheckResult = {
  ok: boolean;
  detail: string;
  warn?: boolean;
  reason?: "unreachable" | "migrations_pending" | "base_url_env_unset";
};

export type SetupChecksPayload = {
  checks: {
    database: SetupCheckResult;
    redis: SetupCheckResult;
    encryption: SetupCheckResult;
    base_url: SetupCheckResult;
  };
  /** Background worker heartbeat — a sibling of `checks`, not a member of it: it's shown on
   * the topbar pill next to the other four, but deliberately excluded from `setupChecksAllOk`'s
   * wizard-completion gate, since Admitto is usable without a worker running (mail delivery,
   * import/export, and bounce ingest just queue up instead of failing outright). */
  worker: SetupCheckResult;
};

/** Shared "this simple probe took too long" cutoff for the database `SELECT 1` and the Redis
 * ping — both are normally sub-10ms operations, so 500ms is generous enough to avoid false
 * positives while still catching real degradation (pool exhaustion, network saturation). No
 * existing latency convention elsewhere in the repo to anchor on; retune this one constant if
 * it proves too sensitive or not sensitive enough. */
const SLOW_RESPONSE_THRESHOLD_MS = 500;

/** Extracted so the threshold itself is unit-testable without simulating real delays. */
export function classifyLatency(
  elapsedMs: number,
  thresholdMs: number = SLOW_RESPONSE_THRESHOLD_MS,
): "ok" | "degraded" {
  return elapsedMs >= thresholdMs ? "degraded" : "ok";
}

/** DB reachability plus Prisma schema parity (migrations run at container boot). */
async function checkDatabaseWithMigrations(db: PrismaClient): Promise<SetupCheckResult> {
  const started = Date.now();
  try {
    await db.$queryRaw(Prisma.sql`SELECT 1`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Cannot connect to PostgreSQL";
    return { ok: false, detail, reason: "unreachable" };
  }
  const elapsedMs = Date.now() - started;

  const migrationsStatus = await checkMigrationsStatus(db);
  if (migrationsStatus !== "ok") {
    return {
      ok: false,
      detail: "PostgreSQL connected · migrations pending",
      reason: "migrations_pending",
    };
  }

  if (classifyLatency(elapsedMs) === "degraded") {
    return {
      ok: true,
      warn: true,
      detail: `PostgreSQL connected · migrations current · slow response (${elapsedMs} ms)`,
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

/** True in development/test environments, where instance URL configuration is more lenient. */
function isDevOrTestEnv(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "development" || env.NODE_ENV === "test";
}

/** Normalize an explicitly provided base URL (injected app URL or BASE_URL env). */
function checkExplicitBaseUrl(
  rawUrl: string,
  env: NodeJS.ProcessEnv,
  invalidDetail: string,
): SetupCheckResult {
  try {
    const normalized = normalizeRuntimeBaseUrl(rawUrl, env);
    return { ok: true, detail: normalized };
  } catch (err) {
    const detail = err instanceof Error ? err.message : invalidDetail;
    return { ok: false, detail };
  }
}

/** Validate an instance URL persisted in Settings. This check specifically wants the BASE_URL
 * env var outside development - the running app itself accepts a Settings-only value in every
 * environment (resolveInstanceBaseUrl() falls back to it), so this is a checklist preference,
 * not a boot requirement the app actually enforces. */
function checkPersistedInstanceUrl(dbUrl: string, env: NodeJS.ProcessEnv): SetupCheckResult {
  try {
    const normalized = normalizePersistedInstanceUrl(dbUrl);
    if (!isDevOrTestEnv(env)) {
      return {
        ok: false,
        reason: "base_url_env_unset",
        detail: "BASE_URL environment variable is not set; this check wants it set explicitly",
      };
    }
    return { ok: true, detail: normalized };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Invalid instance URL in settings";
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
    return checkExplicitBaseUrl(injected, env, "Invalid instance URL");
  }

  const envRaw = env.BASE_URL?.trim();
  if (envRaw) {
    return checkExplicitBaseUrl(envRaw, env, "Invalid BASE_URL");
  }

  const dbUrl = await getInstanceUrl(db);
  if (dbUrl) {
    return checkPersistedInstanceUrl(dbUrl, env);
  }

  if (isDevOrTestEnv(env)) {
    return {
      ok: true,
      warn: true,
      detail: "Instance URL optional in development; set in Settings → General or BASE_URL env",
    };
  }

  return {
    ok: false,
    detail: "BASE_URL environment variable is not set; this check wants it set explicitly",
  };
}

/** Background worker heartbeat, mapped to the topbar's ok/warn vocabulary. Never `ok: false` —
 * a missing or stale worker degrades mail delivery, import/export, and bounce ingest, it
 * doesn't break the app itself, so this reads the same "degraded" severity as the Health check
 * tab's `background_worker` row, never "down". */
export async function checkWorker(
  db: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SetupCheckResult> {
  const heartbeat = await checkWorkerHeartbeat(db, new Date(), env).catch(() => null);
  if (heartbeat === null) {
    return { ok: true, warn: true, detail: "Could not read the worker heartbeat" };
  }
  if (heartbeat.state === "never_ran") {
    return {
      ok: true,
      warn: true,
      detail: "Worker has never reported a heartbeat. Run npm run worker or the compose worker service.",
    };
  }
  if (heartbeat.state === "stale") {
    return {
      ok: true,
      warn: true,
      detail: `Worker heartbeat is stale (last seen ${heartbeat.lastBeatAt.toISOString()})`,
    };
  }
  return { ok: true, detail: `Worker heartbeat is fresh (last seen ${heartbeat.lastBeatAt.toISOString()})` };
}

/** Redis result for a ping that didn't error (caller already handled `"degraded"`). */
function describeAvailableRedis(status: "ok" | "disabled", latencyMs: number): SetupCheckResult {
  if (status === "disabled") {
    return { ok: true, detail: "In-memory rate limit store (no Redis)" };
  }
  if (classifyLatency(latencyMs) === "degraded") {
    return { ok: true, warn: true, detail: `Redis OK (${latencyMs} ms) · slow` };
  }
  return { ok: true, detail: `Redis OK (${latencyMs} ms)` };
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
      : describeAvailableRedis(redisProbe.status, redisProbe.latency_ms ?? 0);

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
  const worker = await checkWorker(db);
  const payload: SetupChecksPayload = { checks, worker };

  return c.json(payload, 200);
}
