/**
 * Postgres LISTEN client that wakes the worker loop immediately when a job is enqueued
 * (admitto_worker_wake channel), instead of waiting up to a full tick (ADR 0042 follow-up).
 * Uses a dedicated `pg` connection, same pattern as worker-locks.ts. A dead/unavailable
 * connection degrades waitForWakeOrTimeout to a plain timeout, so this is a pure latency
 * optimization on top of the existing fixed-tick poll loop, never a correctness dependency.
 */
import pg from "pg";

const { Client } = pg;

export const WORKER_WAKE_CHANNEL = "admitto_worker_wake";

export type WorkerNotifyClient = {
  /** True once the underlying connection has errored; caller should reconnect. */
  isAlive(): boolean;
  /** Resolves on the next wake notification, or after `ms`, whichever comes first. */
  waitForWakeOrTimeout(ms: number, signal: { stopped: boolean }): Promise<void>;
  close(): Promise<void>;
};

function log(message: string): void {
  const ts = new Date().toISOString();
  console.log(`[worker:notify] ${ts} ${message}`);
}

/**
 * Opens a dedicated LISTEN connection. Caller must `close()` on shutdown.
 */
export async function openWorkerNotifyClient(connectionString: string): Promise<WorkerNotifyClient> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });
  let alive = true;
  // Latches a notification that arrives while nothing is awaiting waitForWakeOrTimeout
  // (e.g. a burst of inserts while the worker is mid-tick) so it isn't lost.
  let wakePending = false;
  let onWake: (() => void) | null = null;

  client.on("notification", () => {
    wakePending = true;
    onWake?.();
  });
  client.on("error", (err: unknown) => {
    alive = false;
    log(`connection error, falling back to poll-only: ${err instanceof Error ? err.message : String(err)}`);
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${WORKER_WAKE_CHANNEL}`);
  } catch (err) {
    await client.end().catch(() => undefined);
    throw err;
  }

  return {
    isAlive(): boolean {
      return alive;
    },
    waitForWakeOrTimeout(ms: number, signal: { stopped: boolean }): Promise<void> {
      if (wakePending) {
        wakePending = false;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const started = Date.now();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearInterval(timer);
          onWake = null;
          resolve();
        };
        onWake = () => {
          wakePending = false;
          finish();
        };
        const timer = setInterval(() => {
          if (signal.stopped || Date.now() - started >= ms) finish();
        }, 200);
      });
    },
    async close(): Promise<void> {
      try {
        if (alive) await client.query(`UNLISTEN ${WORKER_WAKE_CHANNEL}`);
      } catch {
        // best-effort
      } finally {
        await client.end();
      }
    },
  };
}
