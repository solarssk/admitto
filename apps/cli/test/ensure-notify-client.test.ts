import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

const openWorkerNotifyClient = vi.fn();

vi.mock("../src/commands/worker-notify.js", () => ({ openWorkerNotifyClient }));

const { ensureNotifyClient } = await import("../src/commands/worker.js");

function fakeClient() {
  return {
    isAlive: vi.fn(() => true),
    waitForWakeOrTimeout: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe("ensureNotifyClient", () => {
  beforeEach(() => {
    openWorkerNotifyClient.mockReset();
    resetSystemLogBufferForTest();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses the current client when it's still alive", async () => {
    const current = fakeClient();
    const result = await ensureNotifyClient("postgresql://example/db", current as never);
    expect(result).toBe(current);
    expect(openWorkerNotifyClient).not.toHaveBeenCalled();
  });

  it("closes a dead client and connects a fresh one", async () => {
    const dead = fakeClient();
    dead.isAlive.mockReturnValue(false);
    const fresh = fakeClient();
    openWorkerNotifyClient.mockResolvedValue(fresh);

    const result = await ensureNotifyClient("postgresql://example/db", dead as never);
    expect(dead.close).toHaveBeenCalledOnce();
    expect(result).toBe(fresh);
  });

  it("connects fresh when there is no current client", async () => {
    const fresh = fakeClient();
    openWorkerNotifyClient.mockResolvedValue(fresh);
    const result = await ensureNotifyClient("postgresql://example/db", null);
    expect(result).toBe(fresh);
  });

  it("returns null and does not throw when reconnecting fails", async () => {
    openWorkerNotifyClient.mockRejectedValue(new Error("connection refused"));
    const result = await ensureNotifyClient("postgresql://example/db", null);
    expect(result).toBeNull();
  });

  it("records the reconnect failure as a warn-level worker system-log entry", async () => {
    openWorkerNotifyClient.mockRejectedValue(new Error("connection refused"));
    await ensureNotifyClient("postgresql://example/db", null);

    const [entry] = querySystemLogs({ source: "worker" });
    expect(entry).toMatchObject({
      level: "warn",
      message: expect.stringContaining("notify client unavailable"),
      fields: { job: "heartbeat" },
    });
  });

  it("records a successful reconnect as an info-level worker system-log entry", async () => {
    const fresh = fakeClient();
    openWorkerNotifyClient.mockResolvedValue(fresh);
    await ensureNotifyClient("postgresql://example/db", null);

    // Success itself doesn't call log() - only the fallback-to-poll-only branch does. Confirms
    // the happy path leaves no stray entry behind for this same job.
    expect(querySystemLogs({ source: "worker" })).toHaveLength(0);
  });
});
