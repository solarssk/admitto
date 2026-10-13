import type { PrismaClient } from "./generated/prisma/client.js";

/** Epoch to 0001-01-01 UTC. Prisma's PostgreSQL adapter formats AD years only
 * (without a BC suffix), so cutoffs must also stay within that database range. */
export const MAX_STALE_INTERVAL_MS = 62_135_596_800_000;

/** Singleton heartbeat row id (ADR 0042 / `BackgroundWorkerHeartbeat`). */
export const WORKER_HEARTBEAT_ID = "default";

/**
 * Stale window for Health / HEALTHCHECK / pending-job reclaim.
 * Floor 5 minutes so a long import/export drain inside one tick does not
 * false-alarm; otherwise 3× tick + 60s slack (default tick 60s → 5m floor).
 * Keep identical to Settings → Health worker check.
 */
export function workerHeartbeatStaleMs(tickSeconds: number): number {
  const tick = Number.isFinite(tickSeconds) && tickSeconds > 0 ? tickSeconds : 60;
  return positiveMsOr(Math.max(300_000, tick * 3 * 1000 + 60_000), 300_000);
}

/** Default (= `workerHeartbeatStaleMs(60)`). Used when reclaim has no tick override. */
export const DEFAULT_WORKER_HEARTBEAT_STALE_MS = workerHeartbeatStaleMs(60);

/** Positive finite ms within Date bounds, else fallback; preserve fractional flooring. */
export function positiveMsOr(
  value: number | undefined,
  fallback: number,
  nowMs = Date.now(),
): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0 || value > MAX_STALE_INTERVAL_MS) {
    return fallback;
  }
  const interval = Math.floor(value);
  const cutoff = nowMs - interval;
  return cutoff >= -MAX_STALE_INTERVAL_MS && Number.isFinite(new Date(cutoff).getTime())
    ? interval
    : fallback;
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
