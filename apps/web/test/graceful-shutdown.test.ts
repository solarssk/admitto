import { afterEach, describe, expect, it, vi } from "vitest";
import { createGracefulShutdown, type CloseableServer } from "../src/graceful-shutdown.js";

function fakeLog() {
  return { info: vi.fn(), warn: vi.fn() };
}

function instantServer(): CloseableServer {
  return {
    close: (cb) => cb(),
    closeAllConnections: vi.fn(),
  };
}

/** Simulates a server holding an open SSE connection: close() never calls back on its own, but
 * closeAllConnections() destroys the connection and fires the pending callback - same as Node's
 * real http.Server. */
function hangingServer(): CloseableServer {
  let pendingClose: (() => void) | undefined;
  return {
    close: (cb) => {
      pendingClose = cb;
    },
    closeAllConnections: vi.fn(() => pendingClose?.()),
  };
}

describe("createGracefulShutdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes servers and disconnects cleanly when nothing is hanging", async () => {
    const server = instantServer();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const log = fakeLog();
    const shutdown = createGracefulShutdown({ servers: [server], disconnect, log });

    await shutdown("SIGTERM");

    expect(server.closeAllConnections).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(log.info).toHaveBeenCalledWith("shutdown signal received", { signal: "SIGTERM" });
    expect(log.info).toHaveBeenCalledWith("shutdown complete", { signal: "SIGTERM" });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("force-closes connections still open after timeoutMs", async () => {
    vi.useFakeTimers();
    const server = hangingServer();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const log = fakeLog();
    const shutdown = createGracefulShutdown({
      servers: [server],
      disconnect,
      timeoutMs: 1_000,
      log,
    });

    const done = shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(1_000);
    await done;

    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith("shutdown: forcing open connections closed", {
      timeoutMs: 1_000,
    });
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("ignores a second signal while shutdown is already in progress", async () => {
    const server = instantServer();
    const closeSpy = vi.fn((cb: () => void) => cb());
    server.close = closeSpy;
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const shutdown = createGracefulShutdown({ servers: [server], disconnect, log: fakeLog() });

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

    expect(closeSpy).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("does not block exit when the database disconnect times out", async () => {
    vi.useFakeTimers();
    const server = instantServer();
    const disconnect = vi.fn(() => new Promise<void>(() => {}));
    const log = fakeLog();
    const shutdown = createGracefulShutdown({
      servers: [server],
      disconnect,
      disconnectTimeoutMs: 500,
      log,
    });

    const done = shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(500);
    await done;

    expect(log.warn).toHaveBeenCalledWith(
      "shutdown: database disconnect timed out, exiting anyway",
      { disconnectTimeoutMs: 500 },
    );
  });

  it("logs and continues when disconnect rejects", async () => {
    const server = instantServer();
    const disconnect = vi.fn().mockRejectedValue(new Error("db gone"));
    const log = fakeLog();
    const shutdown = createGracefulShutdown({ servers: [server], disconnect, log });

    await shutdown("SIGTERM");

    expect(log.warn).toHaveBeenCalledWith("shutdown: database disconnect failed", {
      error: "db gone",
    });
    expect(log.info).toHaveBeenCalledWith("shutdown complete", { signal: "SIGTERM" });
  });
});
