import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

const { checkMigrationsStatus, checkRedis } = vi.hoisted(() => ({
  checkMigrationsStatus: vi.fn(),
  checkRedis: vi.fn(),
}));

vi.mock("../../src/ops/migrations-check.js", () => ({ checkMigrationsStatus }));
vi.mock("../../src/ops/readyz.js", () => ({ checkRedis }));

import {
  classifyLatency,
  collectSetupChecks,
  setupChecksAllOk,
  type SetupChecksPayload,
} from "../../src/admin/setup-checks-routes.js";

const okChecks: SetupChecksPayload["checks"] = {
  database: { ok: true, detail: "PostgreSQL connected · migrations current" },
  redis: { ok: true, detail: "Redis OK (1 ms)" },
  encryption: { ok: true, detail: "ENCRYPTION_KEY configured (32 bytes)" },
  base_url: { ok: true, detail: "https://tickets.example.com" },
};

describe("setupChecksAllOk", () => {
  it("returns true when every check passed", () => {
    expect(setupChecksAllOk(okChecks)).toBe(true);
  });

  it("returns true when base_url is ok with warn flag", () => {
    expect(
      setupChecksAllOk({
        ...okChecks,
        base_url: {
          ok: true,
          warn: true,
          detail: "Instance URL optional in development",
        },
      }),
    ).toBe(true);
  });

  it("returns false when any check failed", () => {
    expect(
      setupChecksAllOk({
        ...okChecks,
        database: { ok: false, detail: "PostgreSQL connected · migrations pending" },
      }),
    ).toBe(false);
  });
});

/** Extract SQL template text from a Prisma tagged `$queryRaw` argument for test assertions
 * (mirrors `apps/web/test/integration/readyz.test.ts`'s helper of the same name). */
function queryRawSqlText(query: unknown): string {
  if (typeof query === "object" && query !== null && "strings" in query) {
    return (query as Prisma.Sql).strings.join("");
  }
  return String(query);
}

function createMockPrisma(queryRaw: (query: unknown) => Promise<unknown>): PrismaClient {
  return { $queryRaw: vi.fn(queryRaw) } as unknown as PrismaClient;
}

describe("collectSetupChecks Redis status", () => {
  it("reports both in-memory and healthy Redis stores as available", async () => {
    checkMigrationsStatus.mockResolvedValue("ok");
    checkRedis
      .mockResolvedValueOnce({ status: "disabled", latency_ms: null })
      .mockResolvedValueOnce({ status: "ok", latency_ms: null });
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) };

    const disabled = await collectSetupChecks(db as never, {} as never, "https://admitto.example.com");
    const healthy = await collectSetupChecks(db as never, {} as never, "https://admitto.example.com");

    expect(disabled.redis).toEqual({ ok: true, detail: "In-memory rate limit store (no Redis)" });
    expect(healthy.redis).toEqual({ ok: true, detail: "Redis OK (0 ms)" });
  });
});

describe("classifyLatency", () => {
  it("is ok comfortably under the threshold", () => {
    expect(classifyLatency(0, 500)).toBe("ok");
  });

  it("is ok one millisecond under the threshold", () => {
    expect(classifyLatency(499, 500)).toBe("ok");
  });

  it("is degraded exactly at the threshold", () => {
    expect(classifyLatency(500, 500)).toBe("degraded");
  });

  it("is degraded over the threshold", () => {
    expect(classifyLatency(501, 500)).toBe("degraded");
  });

  it("defaults to the shared 500ms threshold when none is passed", () => {
    expect(classifyLatency(499)).toBe("ok");
    expect(classifyLatency(500)).toBe("degraded");
  });
});

describe("collectSetupChecks — database reason", () => {
  it('reports reason "unreachable" when the connection itself fails', async () => {
    const db = createMockPrisma(async () => {
      throw new Error("connection refused");
    });
    checkRedis.mockResolvedValueOnce({ status: "ok", latency_ms: 1 });

    const checks = await collectSetupChecks(db, {} as never, "https://tickets.example.com");

    expect(checks.database.ok).toBe(false);
    expect(checks.database.reason).toBe("unreachable");
  });

  it('reports reason "migrations_pending" when migration history can\'t be confirmed current', async () => {
    const db = createMockPrisma(async () => [{ "?column?": 1 }]);
    checkMigrationsStatus.mockResolvedValueOnce("pending");
    checkRedis.mockResolvedValueOnce({ status: "ok", latency_ms: 1 });

    const checks = await collectSetupChecks(db, {} as never, "https://tickets.example.com");

    expect(checks.database.ok).toBe(false);
    expect(checks.database.reason).toBe("migrations_pending");
  });

  it("marks the database check degraded (not down) when SELECT 1 takes at least the slow-response threshold", async () => {
    vi.useFakeTimers();
    try {
      const db = createMockPrisma(async (query) => {
        // Only the SELECT 1 call is timed — advancing the clock here, before the
        // migrations-status query below, keeps this test independent of query order.
        if (!queryRawSqlText(query).includes("_prisma_migrations")) {
          vi.advanceTimersByTime(600);
        }
        return [{ "?column?": 1 }];
      });
      checkMigrationsStatus.mockResolvedValueOnce("ok");
      checkRedis.mockResolvedValueOnce({ status: "ok", latency_ms: 1 });

      const checks = await collectSetupChecks(db, {} as never, "https://tickets.example.com");

      expect(checks.database.ok).toBe(true);
      expect(checks.database.warn).toBe(true);
      expect(checks.database.detail).toContain("slow response");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("collectSetupChecks — redis latency", () => {
  it("stays ok (no warn) for a fast, healthy ping", async () => {
    const db = createMockPrisma(async () => [{ "?column?": 1 }]);
    checkMigrationsStatus.mockResolvedValueOnce("ok");
    checkRedis.mockResolvedValueOnce({ status: "ok", latency_ms: 5 });

    const checks = await collectSetupChecks(db, {} as never, "https://tickets.example.com");

    expect(checks.redis.ok).toBe(true);
    expect(checks.redis.warn).toBeUndefined();
  });

  it("marks the redis check degraded (not down) when the ping succeeds but is slow", async () => {
    const db = createMockPrisma(async () => [{ "?column?": 1 }]);
    checkMigrationsStatus.mockResolvedValueOnce("ok");
    checkRedis.mockResolvedValueOnce({ status: "ok", latency_ms: 600 });

    const checks = await collectSetupChecks(db, {} as never, "https://tickets.example.com");

    expect(checks.redis.ok).toBe(true);
    expect(checks.redis.warn).toBe(true);
    expect(checks.redis.detail).toContain("slow");
  });
});
