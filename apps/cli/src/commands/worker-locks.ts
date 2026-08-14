/**
 * Session-scoped Postgres advisory locks for Admitto worker job classes (ADR 0042).
 * Uses a dedicated `pg` connection so the lock survives across Prisma pool checkouts.
 */
import pg from "pg";

const { Client } = pg;

/** Stable lock keys (must match across worker processes). */
export const WORKER_LOCK_KEYS = {
  bounce: "admitto:worker:bounce",
  retention: "admitto:worker:retention",
  mail_delivery: "admitto:worker:mail_delivery",
  import: "admitto:worker:import",
  export: "admitto:worker:export",
  wallet_sync: "admitto:worker:wallet_sync",
  wallet_push: "admitto:worker:wallet_push",
  wallet_message: "admitto:worker:wallet_message",
} as const;

export type WorkerLockJob = keyof typeof WORKER_LOCK_KEYS;

export type WorkerLockClient = {
  tryAcquire(job: WorkerLockJob): Promise<boolean>;
  release(job: WorkerLockJob): Promise<void>;
  releaseAll(): Promise<void>;
  close(): Promise<void>;
};

/**
 * Open a dedicated DB client for advisory locks. Caller must `close()` on shutdown.
 */
export async function openWorkerLockClient(connectionString: string): Promise<WorkerLockClient> {
  const client = new Client({ connectionString });
  await client.connect();
  const held = new Set<WorkerLockJob>();

  async function lockId(job: WorkerLockJob): Promise<number> {
    const key = WORKER_LOCK_KEYS[job];
    const result = await client.query<{ lock_id: number }>(
      "SELECT hashtext($1)::int AS lock_id",
      [key],
    );
    const id = result.rows[0]?.lock_id;
    if (id === undefined) throw new Error(`hashtext failed for ${key}`);
    return id;
  }

  async function release(job: WorkerLockJob): Promise<void> {
    if (!held.has(job)) return;
    const id = await lockId(job);
    await client.query("SELECT pg_advisory_unlock($1)", [id]);
    held.delete(job);
  }

  async function releaseAll(): Promise<void> {
    for (const job of held) {
      await release(job);
    }
  }

  return {
    async tryAcquire(job: WorkerLockJob): Promise<boolean> {
      const id = await lockId(job);
      const result = await client.query<{ ok: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS ok",
        [id],
      );
      const ok = result.rows[0]?.ok === true;
      if (ok) held.add(job);
      return ok;
    },
    release,
    releaseAll,
    async close(): Promise<void> {
      try {
        await releaseAll();
      } finally {
        await client.end();
      }
    },
  };
}
