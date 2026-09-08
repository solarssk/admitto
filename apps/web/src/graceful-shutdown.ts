import { logger } from "./logger.js";

/** Structural subset of @hono/node-server's `ServerType` (http.Server | https.Server |
 * http2.Server | Http2SecureServer) this module actually needs. Declared as methods rather than
 * function-typed properties so TS checks `close` bivariantly instead of contravariantly - the
 * real callback signature Node's Server.close() takes is `(err?: Error) => void`, and
 * `closeAllConnections` is only on http.Server/https.Server, never on the http2 variants (this
 * app never produces one - the HTTPS dev branch uses node:https's createServer, not node:http2),
 * so it stays optional here. */
export type CloseableServer = {
  close(callback: () => void): void;
  closeAllConnections?(): void;
};

export type GracefulShutdownDeps = {
  servers: readonly CloseableServer[];
  disconnect: () => Promise<void>;
  /** Max time to let in-flight connections - including held-open SSE streams
   * (admin/sse-channel.ts, admin/checkin-stream-routes.ts) - finish on their own before forcing
   * them closed. Kept under deploy/docker-compose.yml's default (Docker's own) 10s
   * stop_grace_period so a normal shutdown never needs SIGKILL. */
  timeoutMs?: number;
  /** Bounds prisma.$disconnect() separately - the database may already be unreachable (e.g. mid
   * host maintenance, the scenario that motivated this module), and a hung disconnect call must
   * not block process exit. */
  disconnectTimeoutMs?: number;
  log?: Pick<typeof logger, "info" | "warn">;
};

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_DISCONNECT_TIMEOUT_MS = 3_000;

function closeServer(server: CloseableServer): Promise<void> {
  return new Promise((resolve) => server.close(resolve));
}

/** Resolves "done" once `promise` settles, or "timeout" after `ms`, whichever comes first.
 * `promise` itself keeps running either way - the caller decides what to do on timeout. */
function raceTimeout(promise: Promise<void>, ms: number): Promise<"done" | "timeout"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    void promise.then(() => {
      clearTimeout(timer);
      resolve("done");
    });
  });
}

/**
 * Builds the SIGTERM/SIGINT handler for the web server: stop accepting new connections, give
 * in-flight ones (SSE streams included) a bounded window to finish, force-close whatever's left,
 * then disconnect Prisma. Does not call process.exit() itself - unlike the CLI/worker processes
 * (apps/cli/src/index.ts, commands/worker.ts), this server has other long-lived resources (the
 * rate-limit store's and SSE fan-out's Redis clients, cache-sweep timers) that aren't torn down
 * here, so the event loop won't drain on its own; the caller must exit explicitly once the
 * returned function resolves. Guards against a second signal re-entering mid-shutdown.
 */
export function createGracefulShutdown(
  deps: GracefulShutdownDeps,
): (signal: string) => Promise<void> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const disconnectTimeoutMs = deps.disconnectTimeoutMs ?? DEFAULT_DISCONNECT_TIMEOUT_MS;
  const log = deps.log ?? logger;
  let shuttingDown = false;

  return async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutdown signal received", { signal });

    const closed = Promise.all(deps.servers.map(closeServer)).then(() => undefined);
    if ((await raceTimeout(closed, timeoutMs)) === "timeout") {
      log.warn("shutdown: forcing open connections closed", { timeoutMs });
      for (const server of deps.servers) server.closeAllConnections?.();
      await closed;
    }

    const disconnected = deps.disconnect().catch((err: unknown) => {
      log.warn("shutdown: database disconnect failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    if ((await raceTimeout(disconnected, disconnectTimeoutMs)) === "timeout") {
      log.warn("shutdown: database disconnect timed out, exiting anyway", {
        disconnectTimeoutMs,
      });
    }

    log.info("shutdown complete", { signal });
  };
}
