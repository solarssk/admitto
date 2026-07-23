import { describe, expect, it, vi } from "vitest";

const { checkMigrationsStatus, checkRedis } = vi.hoisted(() => ({
  checkMigrationsStatus: vi.fn(),
  checkRedis: vi.fn(),
}));

vi.mock("../../src/ops/migrations-check.js", () => ({ checkMigrationsStatus }));
vi.mock("../../src/ops/readyz.js", () => ({ checkRedis }));

import {
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
