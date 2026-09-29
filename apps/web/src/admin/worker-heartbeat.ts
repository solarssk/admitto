import type { PrismaClient } from "@admitto/db";
import { parseBounceIngestTickSeconds, workerHeartbeatStaleMs } from "@admitto/mail-delivery";

export type WorkerHeartbeatCheck =
  | { state: "never_ran" }
  | { state: "stale"; lastBeatAt: Date; hostname: string | null; staleAfterMs: number }
  | { state: "fresh"; lastBeatAt: Date; hostname: string | null };

/**
 * Shared by Health check's own `background_worker` row (health-check-routes.ts) and the
 * topbar System status pill's worker signal (setup-checks-routes.ts), so both read the exact
 * same heartbeat and staleness threshold instead of two independent queries that could
 * disagree about whether the worker is actually stale.
 */
export async function checkWorkerHeartbeat(
  db: PrismaClient,
  now: Date,
  env: NodeJS.ProcessEnv,
): Promise<WorkerHeartbeatCheck> {
  const tickSeconds = parseBounceIngestTickSeconds(env);
  const staleMs = workerHeartbeatStaleMs(tickSeconds);
  const beat = await db.backgroundWorkerHeartbeat.findUnique({
    where: { id: "default" },
    select: { last_beat_at: true, hostname: true },
  });
  if (!beat) return { state: "never_ran" };
  const ageMs = now.getTime() - beat.last_beat_at.getTime();
  if (ageMs > staleMs) {
    return { state: "stale", lastBeatAt: beat.last_beat_at, hostname: beat.hostname, staleAfterMs: staleMs };
  }
  return { state: "fresh", lastBeatAt: beat.last_beat_at, hostname: beat.hostname };
}
