import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { configFromEnv } from "@admitto/mailer";
import type { MailerProvider } from "@admitto/mailer";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import { applyBaselineSecurityHeaders } from "../security-headers.js";
import { InMemoryRateLimitStore } from "../rate-limit/in-memory.js";
import type { RateLimitStore } from "../rate-limit/types.js";
import { logger } from "../logger.js";
import { checkMigrationsStatus } from "./migrations-check.js";
import { resolveProductVersion } from "./product-version.js";

/** Mailer provider id exposed in `/readyz` JSON (ADR 0026 snake_case). */
export type ReadyzApiProvider = "graph" | "smtp" | "power_automate" | "export_only" | null;

/** Postgres probe result for `/readyz`. */
export type ReadyzDatabaseCheck = { status: "ok" | "down"; latency_ms: number };
/** Redis rate-limit store probe result for `/readyz`. */
export type ReadyzRedisCheck = {
  status: "ok" | "degraded" | "disabled";
  latency_ms: number | null;
};
/** Prisma migration drift status for `/readyz`. */
export type ReadyzMigrationsCheck = { status: "ok" | "pending" };
/** Deployment env mailer configuration summary for `/readyz`. */
export type ReadyzMailerCheck = { configured: boolean; provider: ReadyzApiProvider };

/** Per-component readiness checks returned by `/readyz`. */
export type ReadyzChecks = {
  database: ReadyzDatabaseCheck;
  redis: ReadyzRedisCheck;
  migrations: ReadyzMigrationsCheck;
  mailer: ReadyzMailerCheck;
};

/** Operational email delivery counters (aggregates, no PII). */
export type ReadyzGauges = {
  email_deliveries_queued: number;
  email_deliveries_failed_retryable: number;
};

/** Full `/readyz` response body (ADR 0026). */
export type ReadyzResponse = {
  status: "ok" | "degraded" | "unavailable";
  version: string;
  uptime_seconds: number;
  checks: ReadyzChecks;
  gauges: ReadyzGauges;
};

/** Injectable dependencies for `/readyz` handler and payload builder. */
export type ReadyzDeps = {
  db: PrismaClient;
  rateLimitStore: RateLimitStore;
  opsHealthToken: string | null;
  env?: NodeJS.ProcessEnv;
};

type EnvLike = Record<string, string | undefined>;

/** Read ops token from `Authorization: Bearer` or `X-Ops-Token` (empty values rejected). */
export function extractOpsToken(c: Context): string | null {
  const bearer = c.req.header("Authorization");
  if (bearer?.startsWith("Bearer ")) {
    const t = bearer.slice(7).trim();
    return t || null;
  }
  const header = c.req.header("X-Ops-Token");
  return header?.trim() || null;
}

/** Constant-time compare of request token against configured `OPS_HEALTH_TOKEN`. */
export function isValidOpsToken(c: Context, expected: string): boolean {
  const provided = extractOpsToken(c);
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/** Map internal mailer provider id to ADR 0026 API snake_case (`power_automate`). */
export function mapProviderForApi(provider: MailerProvider): Exclude<ReadyzApiProvider, null> {
  if (provider === "powerautomate") return "power_automate";
  return provider;
}

/** Postgres liveness probe with round-trip latency (`SELECT 1`). */
export async function checkDatabase(db: PrismaClient): Promise<ReadyzDatabaseCheck> {
  const started = Date.now();
  try {
    await db.$queryRaw(Prisma.sql`SELECT 1`);
    return { status: "ok", latency_ms: Date.now() - started };
  } catch {
    return { status: "down", latency_ms: Date.now() - started };
  }
}

/** Redis ping when backed by Redis; in-memory store reports `disabled`. */
export async function checkRedis(store: RateLimitStore): Promise<ReadyzRedisCheck> {
  try {
    if (store instanceof InMemoryRateLimitStore) {
      return { status: "disabled", latency_ms: null };
    }
    const result = await store.health();
    return {
      status: result.ok ? "ok" : "degraded",
      latency_ms: result.latencyMs,
    };
  } catch {
    return { status: "degraded", latency_ms: null };
  }
}

/** Read-only migration drift check (disk folders vs `_prisma_migrations`). */
export async function checkMigrations(db: PrismaClient): Promise<ReadyzMigrationsCheck> {
  const status = await checkMigrationsStatus(db);
  return { status };
}

/** Deployment env mailer config only — provider name, no credentials or live ping. */
export function checkMailer(env: EnvLike = process.env): ReadyzMailerCheck {
  try {
    const cfg = configFromEnv(env as NodeJS.ProcessEnv);
    return { configured: true, provider: mapProviderForApi(cfg.provider) };
  } catch {
    return { configured: false, provider: null };
  }
}

/** Aggregate email delivery queue depth; `-1` gauges when DB count fails. */
export async function collectGauges(db: PrismaClient): Promise<ReadyzGauges> {
  try {
    const [email_deliveries_queued, email_deliveries_failed_retryable] = await Promise.all([
      db.emailDelivery.count({ where: { status: "queued" } }),
      db.emailDelivery.count({ where: { status: "failed", retryable: true } }),
    ]);
    return { email_deliveries_queued, email_deliveries_failed_retryable };
  } catch {
    return { email_deliveries_queued: -1, email_deliveries_failed_retryable: -1 };
  }
}

/** Worst-of readiness status and HTTP code (ADR 0026). */
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

/** Run all `/readyz` collectors and assemble the ADR 0026 JSON payload. */
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

/** Token-gated `GET /readyz` handler (404 disabled, 401 bad token, 503 on hard failure). */
export async function handleReadyz(c: Context, deps: ReadyzDeps) {
  applyBaselineSecurityHeaders((name, value) => c.header(name, value));
  const token = deps.opsHealthToken;
  if (!token) {
    return c.body(null, 404);
  }
  if (!isValidOpsToken(c, token)) {
    logger.warn("readyz auth failed", { ip: resolveClientIp(c) });
    return c.body(null, 401);
  }

  try {
    const payload = await buildReadyzPayload(deps);
    const { httpStatus } = computeOverallStatus(payload.checks);
    return c.json(payload, httpStatus);
  } catch {
    return c.json({ status: "unavailable" }, 503);
  }
}
