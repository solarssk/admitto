import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const connect = vi.fn();
const end = vi.fn();
const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

vi.mock("pg", () => ({
  default: {
    Client: class {
      query = query;
      connect = connect;
      end = end;
      on(event: string, cb: (...args: unknown[]) => void) {
        (listeners[event] ??= []).push(cb);
      }
    },
  },
}));

function emit(event: string, ...args: unknown[]) {
  for (const cb of listeners[event] ?? []) cb(...args);
}

const { openWorkerNotifyClient, WORKER_WAKE_CHANNEL } = await import(
  "../src/commands/worker-notify.js"
);

describe("openWorkerNotifyClient", () => {
  beforeEach(() => {
    query.mockReset();
    connect.mockReset();
    end.mockReset();
    connect.mockResolvedValue(undefined);
    end.mockResolvedValue(undefined);
    query.mockResolvedValue(undefined);
    for (const key of Object.keys(listeners)) delete listeners[key];
  });

  it("connects and issues LISTEN on the wake channel", async () => {
    await openWorkerNotifyClient("postgresql://example/db");
    expect(connect).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(`LISTEN ${WORKER_WAKE_CHANNEL}`);
  });

  it("resolves waitForWakeOrTimeout early when a notification arrives", async () => {
    const client = await openWorkerNotifyClient("postgresql://example/db");
    const signal = { stopped: false };
    const wait = client.waitForWakeOrTimeout(60_000, signal);

    let resolved = false;
    wait.then(() => {
      resolved = true;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);

    emit("notification");
    await wait;
    expect(resolved).toBe(true);
  });

  it("resolves at timeout when no notification arrives", async () => {
    const client = await openWorkerNotifyClient("postgresql://example/db");
    const signal = { stopped: false };
    const started = Date.now();
    await client.waitForWakeOrTimeout(250, signal);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  });

  it("stops waiting once signal.stopped flips", async () => {
    const client = await openWorkerNotifyClient("postgresql://example/db");
    const signal = { stopped: false };
    const started = Date.now();
    const wait = client.waitForWakeOrTimeout(60_000, signal);
    setTimeout(() => {
      signal.stopped = true;
    }, 20);
    await wait;
    expect(Date.now() - started).toBeLessThan(1000);
    expect(signal.stopped).toBe(true);
  });

  it("latches a notification that arrives before waitForWakeOrTimeout is called", async () => {
    const client = await openWorkerNotifyClient("postgresql://example/db");
    emit("notification"); // arrives while the worker is busy mid-tick, nobody awaiting yet

    const signal = { stopped: false };
    const started = Date.now();
    await client.waitForWakeOrTimeout(60_000, signal);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("marks the client dead on connection error without throwing", async () => {
    const client = await openWorkerNotifyClient("postgresql://example/db");
    expect(client.isAlive()).toBe(true);
    emit("error", new Error("connection terminated"));
    expect(client.isAlive()).toBe(false);
  });

  it("logs a non-Error thrown value via String() rather than .message", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const client = await openWorkerNotifyClient("postgresql://example/db");
    emit("error", "socket hang up");
    expect(client.isAlive()).toBe(false);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("socket hang up"))).toBe(
      true,
    );
    logSpy.mockRestore();
  });

  it("close() issues UNLISTEN when still alive and always ends the connection", async () => {
    const client = await openWorkerNotifyClient("postgresql://example/db");
    await client.close();
    expect(query).toHaveBeenCalledWith(`UNLISTEN ${WORKER_WAKE_CHANNEL}`);
    expect(end).toHaveBeenCalledOnce();
  });

  it("close() skips UNLISTEN once the client is dead", async () => {
    const client = await openWorkerNotifyClient("postgresql://example/db");
    emit("error", new Error("connection terminated"));
    query.mockClear();
    await client.close();
    expect(query).not.toHaveBeenCalledWith(`UNLISTEN ${WORKER_WAKE_CHANNEL}`);
    expect(end).toHaveBeenCalledOnce();
  });

  it("ends the connection and rethrows when connect() fails, instead of leaking it", async () => {
    connect.mockRejectedValueOnce(new Error("connection refused"));
    await expect(openWorkerNotifyClient("postgresql://example/db")).rejects.toThrow(
      "connection refused",
    );
    expect(end).toHaveBeenCalledOnce();
  });

  it("ends the connection and rethrows when the LISTEN query fails, instead of leaking it", async () => {
    query.mockRejectedValueOnce(new Error("permission denied for channel"));
    await expect(openWorkerNotifyClient("postgresql://example/db")).rejects.toThrow(
      "permission denied for channel",
    );
    expect(end).toHaveBeenCalledOnce();
  });
});
