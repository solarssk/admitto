import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
