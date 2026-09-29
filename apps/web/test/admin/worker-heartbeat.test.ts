import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { checkWorkerHeartbeat } from "../../src/admin/worker-heartbeat.js";

function workerDb(beat: { last_beat_at: Date; hostname: string | null } | null): PrismaClient {
  return {
    backgroundWorkerHeartbeat: {
      findUnique: vi.fn().mockResolvedValue(beat),
    },
  } as unknown as PrismaClient;
}

describe("checkWorkerHeartbeat", () => {
  it("reports never_ran when no heartbeat row exists", async () => {
    const result = await checkWorkerHeartbeat(workerDb(null), new Date("2026-08-03T12:00:00.000Z"), {});

    expect(result).toEqual({ state: "never_ran" });
  });

  it("reports stale when the heartbeat is older than the stale window", async () => {
    const db = workerDb({ last_beat_at: new Date("2026-08-03T11:00:00.000Z"), hostname: "worker-1" });

    const result = await checkWorkerHeartbeat(db, new Date("2026-08-03T12:00:00.000Z"), {});

    expect(result).toEqual({
      state: "stale",
      lastBeatAt: new Date("2026-08-03T11:00:00.000Z"),
      hostname: "worker-1",
      staleAfterMs: 300_000,
    });
  });

  it("reports fresh when the heartbeat is within the stale window", async () => {
    const db = workerDb({ last_beat_at: new Date("2026-08-03T11:59:50.000Z"), hostname: null });

    const result = await checkWorkerHeartbeat(db, new Date("2026-08-03T12:00:00.000Z"), {});

    expect(result).toEqual({
      state: "fresh",
      lastBeatAt: new Date("2026-08-03T11:59:50.000Z"),
      hostname: null,
    });
  });

  it("derives the stale window from BOUNCE_INGEST_TICK_SECONDS when it exceeds the 5m floor", async () => {
    // 8 minutes old: stale when tick=120 → staleMs=420s, matching health-check-routes.test.ts's
    // equivalent case for backgroundWorkerRow (this primitive now backs both call sites).
    const db = workerDb({ last_beat_at: new Date("2026-08-03T11:52:00.000Z"), hostname: "tick-worker" });

    const result = await checkWorkerHeartbeat(db, new Date("2026-08-03T12:00:00.000Z"), {
      BOUNCE_INGEST_TICK_SECONDS: "120",
    });

    expect(result).toMatchObject({ state: "stale", staleAfterMs: 420_000 });
  });
});
