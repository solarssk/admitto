import { describe, expect, it } from "vitest";
import { workerHeartbeatStaleMs, WORKER_HEARTBEAT_ID } from "../src/commands/worker-heartbeat.js";

describe("workerHeartbeatStaleMs", () => {
  it("uses 2× tick + 30s slack with a 90s floor", () => {
    expect(workerHeartbeatStaleMs(60)).toBe(150_000);
    expect(workerHeartbeatStaleMs(10)).toBe(90_000);
    expect(workerHeartbeatStaleMs(120)).toBe(270_000);
  });

  it("falls back safely for non-positive ticks", () => {
    expect(workerHeartbeatStaleMs(0)).toBe(150_000);
    expect(workerHeartbeatStaleMs(Number.NaN)).toBe(150_000);
  });
});

describe("WORKER_HEARTBEAT_ID", () => {
  it("is the singleton row id", () => {
    expect(WORKER_HEARTBEAT_ID).toBe("default");
  });
});
