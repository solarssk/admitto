import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";
import { RedisRateLimitStore } from "../../src/rate-limit/redis.js";
import { findAdmittoRepoRoot } from "../../src/ops/repo-root.js";
import { resetProductVersionCache } from "../../src/ops/product-version.js";

const TEST_TOKEN = "readyz-test-token-32-characters!!";
const BASE_APP_OPTS = {
  baseUrl: "https://tickets.example.com",
  skipCheckinBootValidation: true,
  opsHealthToken: TEST_TOKEN,
} as const;

function queryRawSqlText(query: unknown): string {
  if (typeof query === "object" && query !== null && "strings" in query) {
    return (query as Prisma.Sql).strings.join("");
  }
  return String(query);
}

function appliedMigrationRows() {
  const migrationsDir = join(findAdmittoRepoRoot(), "packages/db/prisma/migrations");
  return readdirSync(migrationsDir)
    .filter((name) => existsSync(join(migrationsDir, name, "migration.sql")))
    .map((migration_name) => ({
      migration_name,
      finished_at: new Date(),
      rolled_back_at: null,
    }));
}

type MockPrismaOpts = {
  queryRaw?: (query: unknown) => Promise<unknown>;
  queuedCount?: number;
  failedRetryableCount?: number;
};

function createMockPrisma(opts: MockPrismaOpts = {}): PrismaClient {
  const queryRaw =
    opts.queryRaw ??
    (async (query: unknown) => {
      if (queryRawSqlText(query).includes("_prisma_migrations")) {
        return appliedMigrationRows();
      }
      return [{ "?column?": 1 }];
    });

  return {
    $queryRaw: vi.fn(queryRaw),
    emailDelivery: {
      count: vi.fn(async (args: { where?: { status?: string; retryable?: boolean } }) => {
        const status = args?.where?.status;
        if (status === "queued") return opts.queuedCount ?? 0;
        if (status === "failed" && args?.where?.retryable === true) {
          return opts.failedRetryableCount ?? 0;
        }
        return 0;
      }),
    },
  } as unknown as PrismaClient;
}

/** Redis-backed store that never connects; health() always fails. */
class DegradedRedisStore extends RedisRateLimitStore {
  constructor() {
    super("redis://127.0.0.1:6379");
  }

  override async health() {
    return { ok: false, latencyMs: 5 };
  }

  override async hit() {
    return { allowed: true, remaining: 99, resetAt: Date.now() + 60_000 };
  }
}

function authHeaders(token = TEST_TOKEN): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

describe("GET /readyz", () => {
  it("returns 404 when OPS_HEALTH_TOKEN is not configured", async () => {
    const app = createApp({
      ...BASE_APP_OPTS,
      opsHealthToken: null,
      prisma: createMockPrisma(),
    });

    const res = await app.request("/readyz", { headers: authHeaders() });
    expect(res.status).toBe(404);
  });

  it("returns 401 for missing token", async () => {
    const app = createApp({
      ...BASE_APP_OPTS,
      prisma: createMockPrisma(),
    });

    const res = await app.request("/readyz");
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
  });

  it("returns 401 for wrong token", async () => {
    const app = createApp({
      ...BASE_APP_OPTS,
      prisma: createMockPrisma(),
    });

    const res = await app.request("/readyz", { headers: authHeaders("wrong-token") });
    expect(res.status).toBe(401);
  });

  it("returns 401 for Authorization Bearer with empty token", async () => {
    const app = createApp({
      ...BASE_APP_OPTS,
      prisma: createMockPrisma(),
    });

    const res = await app.request("/readyz", {
      headers: { Authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 with ADR 0026 response shape when authorized via Bearer", async () => {
    resetProductVersionCache();
    const app = createApp({
      ...BASE_APP_OPTS,
      prisma: createMockPrisma({ queuedCount: 2, failedRetryableCount: 1 }),
      rateLimitStore: new InMemoryRateLimitStore(),
    });

    const res = await app.request("/readyz", { headers: authHeaders() });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      version: string;
      uptime_seconds: number;
      [key: string]: unknown;
    };
    expect(body).toMatchObject({
      status: "ok",
      checks: {
        database: { status: "ok", latency_ms: expect.any(Number) },
        redis: { status: "disabled", latency_ms: null },
        migrations: { status: "ok" },
        mailer: { configured: expect.any(Boolean), provider: null },
      },
      gauges: {
        email_deliveries_queued: 2,
        email_deliveries_failed_retryable: 1,
      },
    });
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
    expect(typeof body.uptime_seconds).toBe("number");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/password|secret|DATABASE_URL|clientSecret|connection/i);
  });

  it("accepts X-Ops-Token without Authorization header", async () => {
    const app = createApp({
      ...BASE_APP_OPTS,
      prisma: createMockPrisma(),
      rateLimitStore: new InMemoryRateLimitStore(),
    });

    const res = await app.request("/readyz", {
      headers: { "X-Ops-Token": TEST_TOKEN },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("returns 503 unavailable when database is down", async () => {
    const app = createApp({
      ...BASE_APP_OPTS,
      prisma: createMockPrisma({
        queryRaw: async (query) => {
          if (queryRawSqlText(query).includes("_prisma_migrations")) {
            return appliedMigrationRows();
          }
          throw new Error("connection refused");
        },
      }),
      rateLimitStore: new InMemoryRateLimitStore(),
    });

    const res = await app.request("/readyz", { headers: authHeaders() });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      status: "unavailable",
      checks: {
        database: { status: "down", latency_ms: expect.any(Number) },
      },
    });
  });

  it("reports redis disabled with in-memory store and overall ok", async () => {
    const app = createApp({
      ...BASE_APP_OPTS,
      prisma: createMockPrisma(),
      rateLimitStore: new InMemoryRateLimitStore(),
    });

    const res = await app.request("/readyz", { headers: authHeaders() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      checks: {
        redis: { status: "disabled", latency_ms: null },
      },
    });
  });

  it("returns 200 degraded when Redis health fails", async () => {
    const app = createApp({
      ...BASE_APP_OPTS,
      prisma: createMockPrisma(),
      rateLimitStore: new DegradedRedisStore(),
    });

    const res = await app.request("/readyz", { headers: authHeaders() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "degraded",
      checks: {
        redis: { status: "degraded", latency_ms: 5 },
      },
    });
  });

  it("counts queued and failed retryable email deliveries", async () => {
    const app = createApp({
      ...BASE_APP_OPTS,
      prisma: createMockPrisma({ queuedCount: 7, failedRetryableCount: 3 }),
      rateLimitStore: new InMemoryRateLimitStore(),
    });

    const res = await app.request("/readyz", { headers: authHeaders() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      gauges: {
        email_deliveries_queued: 7,
        email_deliveries_failed_retryable: 3,
      },
    });
  });
});
