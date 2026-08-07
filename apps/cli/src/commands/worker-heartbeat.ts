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

/**
 * Stale window for Settings → Health.
 * Floor 5 minutes so a long import/export drain inside one tick does not false-alarm;
 * otherwise 3× tick + 60s slack (default tick 60s → 5m floor).
 */
export function workerHeartbeatStaleMs(tickSeconds: number): number {
  const tick = Number.isFinite(tickSeconds) && tickSeconds > 0 ? tickSeconds : 60;
  return Math.max(300_000, tick * 3 * 1000 + 60_000);
}
