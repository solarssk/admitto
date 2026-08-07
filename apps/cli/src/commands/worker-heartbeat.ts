import { hostname as osHostname } from "node:os";
import type { PrismaClient } from "@admitto/db";

export const WORKER_HEARTBEAT_ID = "default";

/** Upsert the singleton worker heartbeat row (every tick, ADR 0042). */
export async function touchWorkerHeartbeat(
  db: PrismaClient,
  now: Date = new Date(),
  hostname: string = osHostname(),
): Promise<void> {
  await db.backgroundWorkerHeartbeat.upsert({
    where: { id: WORKER_HEARTBEAT_ID },
    create: {
      id: WORKER_HEARTBEAT_ID,
      last_beat_at: now,
      hostname,
    },
    update: {
      last_beat_at: now,
      hostname,
    },
  });
}

/** Stale window for Health / HEALTHCHECK: 2× tick + slack (default tick 60s → 150s). */
export function workerHeartbeatStaleMs(tickSeconds: number): number {
  const tick = Number.isFinite(tickSeconds) && tickSeconds > 0 ? tickSeconds : 60;
  return Math.max(90_000, tick * 2 * 1000 + 30_000);
}
