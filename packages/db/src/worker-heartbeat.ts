import type { PrismaClient } from "./generated/prisma/client.js";

/** Singleton heartbeat row id (ADR 0042 / `BackgroundWorkerHeartbeat`). */
export const WORKER_HEARTBEAT_ID = "default";

/**
 * Default heartbeat stale window for pending job reclaim (matches CLI
 * `workerHeartbeatStaleMs(60)` → 150s).
 */
export const DEFAULT_WORKER_HEARTBEAT_STALE_MS = 150_000;

/** Positive finite ms, else `fallback` (floored). */
export function positiveMsOr(value: number | undefined, fallback: number): number {
  return value && value > 0 ? Math.floor(value) : fallback;
}

/** True when there is no heartbeat row or last_beat_at is older than `staleMs`. */
export async function isWorkerHeartbeatStale(
  db: PrismaClient,
  now: Date,
  staleMs: number = DEFAULT_WORKER_HEARTBEAT_STALE_MS,
): Promise<boolean> {
  const row = await db.backgroundWorkerHeartbeat.findUnique({
    where: { id: WORKER_HEARTBEAT_ID },
    select: { last_beat_at: true },
  });
  if (!row) return true;
  return now.getTime() - row.last_beat_at.getTime() >= staleMs;
}

/**
 * Prisma `OR` clauses for stale running jobs, plus aged pending when the worker
 * heartbeat gate says reclaim pending is safe.
 */
export function staleAdminJobOrClauses(
  cutoff: Date,
  reclaimPending: boolean,
): Array<
  | { status: "running"; started_at: { lt: Date } }
  | { status: "pending"; created_at: { lt: Date } }
> {
  return [
    { status: "running", started_at: { lt: cutoff } },
    ...(reclaimPending ? [{ status: "pending" as const, created_at: { lt: cutoff } }] : []),
  ];
}
