import { hostname as osHostname } from "node:os";
import type { PrismaClient } from "@admitto/db";
import { workerHeartbeatStaleMs as sharedWorkerHeartbeatStaleMs } from "@admitto/mail-delivery";

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

/** Re-export shared Health stale window (same formula as Settings → Health). */
export const workerHeartbeatStaleMs = sharedWorkerHeartbeatStaleMs;
