import { describe, expect, it, vi } from "vitest";
import {
  touchWorkerHeartbeat,
  workerHeartbeatStaleMs,
  WORKER_HEARTBEAT_ID,
} from "../src/commands/worker-heartbeat.js";

describe("workerHeartbeatStaleMs", () => {
  it("uses 3× tick + 60s slack with a 5m floor", () => {
    expect(workerHeartbeatStaleMs(60)).toBe(300_000);
    expect(workerHeartbeatStaleMs(10)).toBe(300_000);
    expect(workerHeartbeatStaleMs(120)).toBe(420_000);
  });

  it("falls back safely for non-positive ticks", () => {
    expect(workerHeartbeatStaleMs(0)).toBe(300_000);
    expect(workerHeartbeatStaleMs(Number.NaN)).toBe(300_000);
  });
});

describe("WORKER_HEARTBEAT_ID", () => {
  it("is the singleton row id", () => {
    expect(WORKER_HEARTBEAT_ID).toBe("default");
  });
});

describe("touchWorkerHeartbeat", () => {
  it("upserts the singleton heartbeat row", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-08-07T12:00:00.000Z");

    await touchWorkerHeartbeat({ backgroundWorkerHeartbeat: { upsert } } as never, now, "worker-1");

    expect(upsert).toHaveBeenCalledWith({
      where: { id: WORKER_HEARTBEAT_ID },
      create: {
        id: WORKER_HEARTBEAT_ID,
        last_beat_at: now,
        hostname: "worker-1",
      },
      update: {
        last_beat_at: now,
        hostname: "worker-1",
      },
    });
  });
});
