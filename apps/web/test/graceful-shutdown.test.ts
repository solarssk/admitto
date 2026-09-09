import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGracefulShutdown,
  installGracefulShutdown,
  type CloseableServer,
} from "../src/graceful-shutdown.js";

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

  it("returns the same promise to a second signal instead of one that resolves early", async () => {
    let releaseClose: (() => void) | undefined;
    const server: CloseableServer = {
      close: (cb) => {
        releaseClose = cb;
      },
    };
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const shutdown = createGracefulShutdown({ servers: [server], disconnect, log: fakeLog() });

    const first = shutdown("SIGTERM");
    const second = shutdown("SIGINT");
    expect(second).toBe(first);

    let secondResolved = false;
    void second.then(() => {
      secondResolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondResolved).toBe(false);

    releaseClose?.();
    await second;
    expect(secondResolved).toBe(true);
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

  it("stringifies a non-Error disconnect rejection", async () => {
    const server = instantServer();
    const disconnect = vi.fn().mockRejectedValue("db gone");
    const log = fakeLog();
    const shutdown = createGracefulShutdown({ servers: [server], disconnect, log });

    await shutdown("SIGTERM");

    expect(log.warn).toHaveBeenCalledWith("shutdown: database disconnect failed", {
      error: "db gone",
    });
  });

  it("falls back to the real logger when none is injected", async () => {
    const server = instantServer();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const shutdown = createGracefulShutdown({ servers: [server], disconnect });

    await expect(shutdown("SIGTERM")).resolves.toBeUndefined();
  });
});

describe("installGracefulShutdown", () => {
  /** Registers the handler, fires it, waits for its async chain to settle, then removes only
   * the listener this call added - never a bare `removeAllListeners`, which would also strip
   * whatever the test runner itself has registered on the shared process object. */
  async function triggerSignal(
    signal: "SIGTERM" | "SIGINT",
    servers: readonly CloseableServer[],
    disconnect: () => Promise<void>,
    exit: (code: number) => void,
  ): Promise<void> {
    const before = process.listeners(signal);
    installGracefulShutdown(servers, disconnect, exit);
    const added = process.listeners(signal).filter((l) => !before.includes(l));

    process.emit(signal);
    await new Promise((resolve) => setImmediate(resolve));

    for (const listener of added) process.removeListener(signal, listener as () => void);
  }

  it("shuts down and exits(0) on SIGTERM", async () => {
    const server = instantServer();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();

    await triggerSignal("SIGTERM", [server], disconnect, exit);

    expect(disconnect).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("shuts down and exits(0) on SIGINT", async () => {
    const server = instantServer();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();

    await triggerSignal("SIGINT", [server], disconnect, exit);

    expect(disconnect).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("does not exit early when a second signal arrives mid-shutdown", async () => {
    const server = hangingServer();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();

    const beforeTerm = process.listeners("SIGTERM");
    const beforeInt = process.listeners("SIGINT");
    installGracefulShutdown([server], disconnect, exit);
    const addedTerm = process.listeners("SIGTERM").filter((l) => !beforeTerm.includes(l));
    const addedInt = process.listeners("SIGINT").filter((l) => !beforeInt.includes(l));

    process.emit("SIGTERM");
    process.emit("SIGINT");
    await new Promise((resolve) => setImmediate(resolve));
    expect(exit).not.toHaveBeenCalled();

    server.closeAllConnections?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(disconnect).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);

    for (const listener of addedTerm) process.removeListener("SIGTERM", listener as () => void);
    for (const listener of addedInt) process.removeListener("SIGINT", listener as () => void);
  });
});
