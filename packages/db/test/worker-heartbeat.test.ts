import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import {
  DEFAULT_WORKER_HEARTBEAT_STALE_MS,
  isWorkerHeartbeatStale,
  positiveMsOr,
  WORKER_HEARTBEAT_ID,
  staleAdminJobOrClauses,
  workerHeartbeatStaleMs,
} from "../src/worker-heartbeat.js";

describe("positiveMsOr", () => {
  it("returns fallback for missing, zero, or negative", () => {
    expect(positiveMsOr(undefined, 100)).toBe(100);
    expect(positiveMsOr(0, 100)).toBe(100);
    expect(positiveMsOr(-1, 100)).toBe(100);
  });

  it("floors a positive value", () => {
    expect(positiveMsOr(1500.9, 100)).toBe(1500);
  });
});

describe("workerHeartbeatStaleMs", () => {
  it("floors at 5 minutes for default and short ticks", () => {
    expect(workerHeartbeatStaleMs(60)).toBe(300_000);
    expect(workerHeartbeatStaleMs(10)).toBe(300_000);
    expect(DEFAULT_WORKER_HEARTBEAT_STALE_MS).toBe(300_000);
  });

  it("scales above the floor for long ticks", () => {
    expect(workerHeartbeatStaleMs(120)).toBe(420_000);
  });

  it("falls back to the 60s tick when invalid", () => {
    expect(workerHeartbeatStaleMs(0)).toBe(300_000);
    expect(workerHeartbeatStaleMs(Number.NaN)).toBe(300_000);
  });
});

describe("isWorkerHeartbeatStale", () => {
  it("is stale when the heartbeat row is missing", async () => {
    const db = {
      backgroundWorkerHeartbeat: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    await expect(isWorkerHeartbeatStale(db, new Date())).resolves.toBe(true);
    expect(db.backgroundWorkerHeartbeat.findUnique).toHaveBeenCalledWith({
      where: { id: WORKER_HEARTBEAT_ID },
      select: { last_beat_at: true },
    });
  });

  it("is stale when last_beat_at is older than the window", async () => {
    const now = new Date("2026-08-07T12:00:00.000Z");
    const db = {
      backgroundWorkerHeartbeat: {
        findUnique: vi.fn().mockResolvedValue({
          last_beat_at: new Date(now.getTime() - DEFAULT_WORKER_HEARTBEAT_STALE_MS - 1),
        }),
      },
    } as unknown as PrismaClient;
    await expect(isWorkerHeartbeatStale(db, now)).resolves.toBe(true);
  });

  it("is fresh when last_beat_at is within the window", async () => {
    const now = new Date("2026-08-07T12:00:00.000Z");
    const db = {
      backgroundWorkerHeartbeat: {
        findUnique: vi.fn().mockResolvedValue({
          last_beat_at: new Date(now.getTime() - 10_000),
        }),
      },
    } as unknown as PrismaClient;
    await expect(isWorkerHeartbeatStale(db, now)).resolves.toBe(false);
  });
});

describe("staleAdminJobOrClauses", () => {
  it("includes pending only when reclaimPending is true", () => {
    const cutoff = new Date("2026-08-07T12:00:00.000Z");
    expect(staleAdminJobOrClauses(cutoff, false)).toEqual([
      { status: "running", started_at: { lt: cutoff } },
    ]);
    expect(staleAdminJobOrClauses(cutoff, true)).toEqual([
      { status: "running", started_at: { lt: cutoff } },
      { status: "pending", created_at: { lt: cutoff } },
    ]);
  });
});
