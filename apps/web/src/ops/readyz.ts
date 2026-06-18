import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { configFromEnv } from "@admitto/mailer";
import type { MailerProvider } from "@admitto/mailer";
import { InMemoryRateLimitStore } from "../rate-limit/in-memory.js";
import { RedisRateLimitStore } from "../rate-limit/redis.js";
import type { RateLimitStore } from "../rate-limit/types.js";
import { checkMigrationsStatus } from "./migrations-check.js";
import { resolveProductVersion } from "./product-version.js";

export type ReadyzApiProvider = "graph" | "smtp" | "power_automate" | "export_only" | null;

export type ReadyzDatabaseCheck = { status: "ok" | "down"; latency_ms: number };
export type ReadyzRedisCheck = {
  status: "ok" | "degraded" | "disabled";
  latency_ms: number | null;
};
export type ReadyzMigrationsCheck = { status: "ok" | "pending" };
export type ReadyzMailerCheck = { configured: boolean; provider: ReadyzApiProvider };

export type ReadyzChecks = {
  database: ReadyzDatabaseCheck;
  redis: ReadyzRedisCheck;
  migrations: ReadyzMigrationsCheck;
  mailer: ReadyzMailerCheck;
};

export type ReadyzGauges = {
  email_deliveries_queued: number;
  email_deliveries_failed_retryable: number;
};

export type ReadyzResponse = {
  status: "ok" | "degraded" | "unavailable";
  version: string;
  uptime_seconds: number;
  checks: ReadyzChecks;
  gauges: ReadyzGauges;
};

export type ReadyzDeps = {
  db: PrismaClient;
  rateLimitStore: RateLimitStore;
  opsHealthToken: string | null;
  env?: NodeJS.ProcessEnv;
};

type EnvLike = Record<string, string | undefined>;

/** Returns configured token or null when unset/blank (endpoint disabled). */
export function resolveOpsHealthToken(env: EnvLike = process.env): string | null {
  const token = env["OPS_HEALTH_TOKEN"]?.trim();
  return token || null;
}

export function extractOpsToken(c: Context): string | null {
  const bearer = c.req.header("Authorization");
  if (bearer?.startsWith("Bearer ")) {
    const t = bearer.slice(7).trim();
    return t || null;
  }
  const header = c.req.header("X-Ops-Token");
  return header?.trim() || null;
}

export function isValidOpsToken(c: Context, expected: string): boolean {
  const provided = extractOpsToken(c);
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export function mapProviderForApi(provider: MailerProvider): Exclude<ReadyzApiProvider, null> {
  if (provider === "powerautomate") return "power_automate";
  return provider;
}

export async function checkDatabase(db: PrismaClient): Promise<ReadyzDatabaseCheck> {
  const started = Date.now();
  try {
    await db.$queryRaw(Prisma.sql`SELECT 1`);
    return { status: "ok", latency_ms: Date.now() - started };
  } catch {
    return { status: "down", latency_ms: Date.now() - started };
  }
}

export async function checkRedis(store: RateLimitStore): Promise<ReadyzRedisCheck> {
  if (store instanceof InMemoryRateLimitStore) {
    return { status: "disabled", latency_ms: null };
  }
  if (store instanceof RedisRateLimitStore) {
    const result = await store.health();
    return {
      status: result.ok ? "ok" : "degraded",
      latency_ms: result.latencyMs,
    };
  }
  const result = await store.health();
  return {
    status: result.ok ? "ok" : "degraded",
    latency_ms: result.latencyMs,
  };
}

export async function checkMigrations(db: PrismaClient): Promise<ReadyzMigrationsCheck> {
  const status = await checkMigrationsStatus(db);
  return { status };
}

export function checkMailer(env: EnvLike = process.env): ReadyzMailerCheck {
  try {
    const cfg = configFromEnv(env as NodeJS.ProcessEnv);
    return { configured: true, provider: mapProviderForApi(cfg.provider) };
  } catch {
    return { configured: false, provider: null };
  }
}

export async function collectGauges(db: PrismaClient): Promise<ReadyzGauges> {
  const [email_deliveries_queued, email_deliveries_failed_retryable] = await Promise.all([
    db.emailDelivery.count({ where: { status: "queued" } }),
    db.emailDelivery.count({ where: { status: "failed", retryable: true } }),
  ]);
  return { email_deliveries_queued, email_deliveries_failed_retryable };
}

export function computeOverallStatus(checks: ReadyzChecks): {
  status: ReadyzResponse["status"];
  httpStatus: 200 | 503;
} {
  if (checks.database.status === "down" || checks.migrations.status === "pending") {
    return { status: "unavailable", httpStatus: 503 };
  }
  if (checks.redis.status === "degraded") {
    return { status: "degraded", httpStatus: 200 };
  }
  return { status: "ok", httpStatus: 200 };
}

export async function buildReadyzPayload(deps: ReadyzDeps): Promise<ReadyzResponse> {
  const env = deps.env ?? process.env;
  const [database, redis, migrations, gauges] = await Promise.all([
    checkDatabase(deps.db),
    checkRedis(deps.rateLimitStore),
    checkMigrations(deps.db),
    collectGauges(deps.db),
  ]);
  const mailer = checkMailer(env);
  const checks: ReadyzChecks = { database, redis, migrations, mailer };
  const { status } = computeOverallStatus(checks);
  return {
    status,
    version: resolveProductVersion(),
    uptime_seconds: Math.floor(process.uptime()),
    checks,
    gauges,
  };
}

export async function handleReadyz(c: Context, deps: ReadyzDeps) {
  const token = deps.opsHealthToken;
  if (!token) {
    return c.body(null, 404);
  }
  if (!isValidOpsToken(c, token)) {
    return c.body(null, 401);
  }

  const payload = await buildReadyzPayload(deps);
  const { httpStatus } = computeOverallStatus(payload.checks);
  return c.json(payload, httpStatus);
}
