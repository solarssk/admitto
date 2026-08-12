import { describe, expect, it, vi } from "vitest";
import type { IngestSummary } from "../../src/bounceIngest/types.js";
import {
  BOUNCE_INGEST_RUN_HISTORY_LIMIT,
  BOUNCE_INGEST_STALE_MS,
  bounceIngestStaleMsForEvent,
  bounceIngestStaleMsForPoll,
  bounceIngestStaleMsFromIntervalSeconds,
  evaluateBounceIngestHealth,
  isBounceIngestDue,
  lastRunOkFromSummary,
  lastRunSummaryFromIngest,
  listBounceIngestRecentRuns,
  parseBounceIngestTickSeconds,
  persistBounceIngestLastRun,
  pruneBounceIngestRunHistory,
  serializeBounceIngestLastRun,
  workerHeartbeatStaleMs,
} from "../../src/bounceIngest/lastRun.js";

function summary(partial: Partial<IngestSummary> = {}): IngestSummary {
  return {
    eventsProcessed: 1,
    messagesSeen: 2,
    bouncesApplied: 1,
    softBouncesLogged: 0,
    unparsed: 0,
    noMatchingDelivery: 0,
    errors: 0,
    connectFailed: false,
    ...partial,
  };
}

describe("lastRunOkFromSummary", () => {
  it("is true when there are no errors and connect succeeded", () => {
    expect(lastRunOkFromSummary(summary())).toBe(true);
  });

  it("is false when connectFailed", () => {
    expect(lastRunOkFromSummary(summary({ connectFailed: true, errors: 1 }))).toBe(false);
  });

  it("is false when errors > 0", () => {
    expect(lastRunOkFromSummary(summary({ errors: 2 }))).toBe(false);
  });
});

describe("lastRunSummaryFromIngest", () => {
  it("copies the per-event counters used by the UI", () => {
    expect(lastRunSummaryFromIngest(summary({ softBouncesLogged: 3, unparsed: 1 }))).toEqual({
      messagesSeen: 2,
      bouncesApplied: 1,
      softBouncesLogged: 3,
      unparsed: 1,
      noMatchingDelivery: 0,
      errors: 0,
      connectFailed: false,
    });
  });
});

describe("serializeBounceIngestLastRun", () => {
  it("returns null when last_run_at is missing", () => {
    expect(serializeBounceIngestLastRun(null, true, { messagesSeen: 1 })).toBeNull();
  });

  it("maps stored JSON into the API DTO", () => {
    const at = new Date("2026-08-06T10:00:00.000Z");
    expect(
      serializeBounceIngestLastRun(at, true, {
        messagesSeen: 4,
        bouncesApplied: 2,
        softBouncesLogged: 1,
        unparsed: 0,
        noMatchingDelivery: 1,
        errors: 0,
        connectFailed: false,
      }),
    ).toEqual({
      at: "2026-08-06T10:00:00.000Z",
      ok: true,
      messagesSeen: 4,
      bouncesApplied: 2,
      softBouncesLogged: 1,
      unparsed: 0,
      noMatchingDelivery: 1,
      errors: 0,
      connectFailed: false,
    });
  });

  it("treats non-true last_run_ok as failed and coerces bad summary fields", () => {
    const at = new Date("2026-08-06T11:00:00.000Z");
    expect(serializeBounceIngestLastRun(at, false, null)).toEqual({
      at: "2026-08-06T11:00:00.000Z",
      ok: false,
      messagesSeen: 0,
      bouncesApplied: 0,
      softBouncesLogged: 0,
      unparsed: 0,
      noMatchingDelivery: 0,
      errors: 0,
      connectFailed: false,
    });
  });
});

describe("persistBounceIngestLastRun", () => {
  it("writes last_run_* and appends a BounceIngestRun row in one transaction", async () => {
    const update = vi.fn().mockResolvedValue({});
    const create = vi.fn().mockResolvedValue({});
    const findMany = vi.fn().mockResolvedValue([{ id: "run_1" }]);
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const tx = {
      bounceIngestSettings: { update },
      bounceIngestRun: { create, findMany, deleteMany },
    };
    const transaction = vi.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx));
    const db = { $transaction: transaction } as never;
    const ranAt = new Date("2026-08-06T12:00:00.000Z");

    await persistBounceIngestLastRun(db, "evt_1", summary({ errors: 1, connectFailed: true }), ranAt);

    expect(transaction).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      where: { event_id: "evt_1" },
      data: {
        last_run_at: ranAt,
        last_run_ok: false,
        last_run_summary: {
          messagesSeen: 2,
          bouncesApplied: 1,
          softBouncesLogged: 0,
          unparsed: 0,
          noMatchingDelivery: 0,
          errors: 1,
          connectFailed: true,
        },
      },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        event_id: "evt_1",
        ran_at: ranAt,
        ok: false,
        summary: {
          messagesSeen: 2,
          bouncesApplied: 1,
          softBouncesLogged: 0,
          unparsed: 0,
          noMatchingDelivery: 0,
          errors: 1,
          connectFailed: true,
        },
      },
    });
    // Fewer than the keep limit → prune is a no-op deleteMany skip.
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("prunes older BounceIngestRun rows when history exceeds the keep limit", async () => {
    const keepIds = Array.from({ length: BOUNCE_INGEST_RUN_HISTORY_LIMIT }, (_, i) => ({
      id: `keep_${i}`,
    }));
    const findMany = vi.fn().mockResolvedValue(keepIds);
    const deleteMany = vi.fn().mockResolvedValue({ count: 5 });
    const update = vi.fn().mockResolvedValue({});
    const create = vi.fn().mockResolvedValue({});
    const tx = {
      bounceIngestSettings: { update },
      bounceIngestRun: { create, findMany, deleteMany },
    };
    const transaction = vi.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx));
    const db = { $transaction: transaction } as never;

    await persistBounceIngestLastRun(db, "evt_1", summary(), new Date("2026-08-06T13:00:00.000Z"));

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        event_id: "evt_1",
        id: { notIn: keepIds.map((r) => r.id) },
      },
    });
  });
});

describe("pruneBounceIngestRunHistory", () => {
  it("returns early when fewer rows than keep exist", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const deleteMany = vi.fn();
    const db = { bounceIngestRun: { findMany, deleteMany } } as never;
    await pruneBounceIngestRunHistory(db, "evt_1", 5);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

describe("listBounceIngestRecentRuns", () => {
  it("maps run rows newest-first and drops unserializable rows", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        ran_at: new Date("2026-08-06T12:00:00.000Z"),
        ok: true,
        summary: { messagesSeen: 3, bouncesApplied: 1 },
      },
      {
        ran_at: null,
        ok: true,
        summary: { messagesSeen: 1 },
      },
    ]);
    const db = { bounceIngestRun: { findMany } } as never;
    const rows = await listBounceIngestRecentRuns(db, "evt_1", 10);
    expect(findMany).toHaveBeenCalledWith({
      where: { event_id: "evt_1" },
      orderBy: { ran_at: "desc" },
      take: 10,
    });
    expect(rows).toEqual([
      {
        at: "2026-08-06T12:00:00.000Z",
        ok: true,
        messagesSeen: 3,
        bouncesApplied: 1,
        softBouncesLogged: 0,
        unparsed: 0,
        noMatchingDelivery: 0,
        errors: 0,
        connectFailed: false,
      },
    ]);
  });
});

describe("bounceIngestStaleMsForPoll", () => {
  it("floors at BOUNCE_INGEST_STALE_MS and scales with Check every", () => {
    expect(bounceIngestStaleMsForPoll(5)).toBe(BOUNCE_INGEST_STALE_MS);
    expect(bounceIngestStaleMsForPoll(60)).toBe(60 * 2 * 60_000);
    expect(bounceIngestStaleMsForPoll(null)).toBe(BOUNCE_INGEST_STALE_MS);
  });
});

describe("workerHeartbeatStaleMs", () => {
  it("uses 3× tick + 60s slack with a 5m floor", () => {
    expect(workerHeartbeatStaleMs(60)).toBe(300_000);
    expect(workerHeartbeatStaleMs(10)).toBe(300_000);
    expect(workerHeartbeatStaleMs(120)).toBe(420_000);
  });

  it("falls back to the default tick for non-positive values", () => {
    expect(workerHeartbeatStaleMs(0)).toBe(300_000);
    expect(workerHeartbeatStaleMs(Number.NaN)).toBe(300_000);
  });
});

describe("isBounceIngestDue", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  it("is due when last_run_at is null", () => {
    expect(isBounceIngestDue({ last_run_at: null, poll_interval_minutes: 5 }, now)).toBe(true);
  });

  it("is not due before poll_interval_minutes elapses after a successful run", () => {
    const last = new Date(now.getTime() - 4 * 60_000);
    expect(
      isBounceIngestDue({ last_run_at: last, last_run_ok: true, poll_interval_minutes: 5 }, now),
    ).toBe(false);
  });

  it("is due once poll_interval_minutes has elapsed after a successful run", () => {
    const last = new Date(now.getTime() - 5 * 60_000);
    expect(
      isBounceIngestDue({ last_run_at: last, last_run_ok: true, poll_interval_minutes: 5 }, now),
    ).toBe(true);
  });

  it("is due on the next tick when the last run failed", () => {
    const last = new Date(now.getTime() - 60_000);
    expect(
      isBounceIngestDue({ last_run_at: last, last_run_ok: false, poll_interval_minutes: 60 }, now),
    ).toBe(true);
  });
});

describe("bounceIngestStaleMs helpers", () => {
  it("floors short Check every and tick windows at BOUNCE_INGEST_STALE_MS", () => {
    expect(bounceIngestStaleMsForPoll(5)).toBe(BOUNCE_INGEST_STALE_MS);
    expect(bounceIngestStaleMsForPoll(null)).toBe(BOUNCE_INGEST_STALE_MS);
    expect(bounceIngestStaleMsFromIntervalSeconds(60)).toBe(BOUNCE_INGEST_STALE_MS);
  });

  it("uses 2× Check every or deploy tick when longer than the floor", () => {
    expect(bounceIngestStaleMsForPoll(60)).toBe(2 * 60 * 60_000);
    expect(bounceIngestStaleMsFromIntervalSeconds(3600)).toBe(7_200_000);
    expect(bounceIngestStaleMsForEvent(5, 3600)).toBe(7_200_000);
    expect(bounceIngestStaleMsForEvent(60, 60)).toBe(2 * 60 * 60_000);
  });

  it("parses TICK over legacy INTERVAL", () => {
    expect(parseBounceIngestTickSeconds({})).toBe(60);
    expect(parseBounceIngestTickSeconds({ BOUNCE_INGEST_INTERVAL_SECONDS: "3600" })).toBe(3600);
    expect(
      parseBounceIngestTickSeconds({
        BOUNCE_INGEST_TICK_SECONDS: "90",
        BOUNCE_INGEST_INTERVAL_SECONDS: "3600",
      }),
    ).toBe(90);
    expect(parseBounceIngestTickSeconds({ BOUNCE_INGEST_TICK_SECONDS: "" })).toBe(60);
    expect(parseBounceIngestTickSeconds({ BOUNCE_INGEST_TICK_SECONDS: "0" })).toBe(60);
    expect(parseBounceIngestTickSeconds({ BOUNCE_INGEST_TICK_SECONDS: "abc" })).toBe(60);
  });

  it("defaults non-positive deploy tick seconds to the 60s wake interval", () => {
    expect(bounceIngestStaleMsFromIntervalSeconds(null)).toBe(BOUNCE_INGEST_STALE_MS);
    expect(bounceIngestStaleMsFromIntervalSeconds(0)).toBe(BOUNCE_INGEST_STALE_MS);
    expect(bounceIngestStaleMsFromIntervalSeconds(Number.NaN)).toBe(BOUNCE_INGEST_STALE_MS);
  });
});

describe("evaluateBounceIngestHealth", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  it("returns not_configured when no enabled rows", () => {
    expect(evaluateBounceIngestHealth([{ enabled: false, last_run_at: null, last_run_ok: null }], now)).toEqual({
      status: "not_configured",
      summary: "Not configured",
      enabledCount: 0,
      problemCount: 0,
    });
  });

  it("returns ok when every enabled row has a fresh successful run", () => {
    const fresh = new Date(now.getTime() - 60_000);
    expect(
      evaluateBounceIngestHealth(
        [{ enabled: true, last_run_at: fresh, last_run_ok: true, poll_interval_minutes: 5 }],
        now,
      ),
    ).toEqual({
      status: "ok",
      summary: "Automatic check ok",
      enabledCount: 1,
      problemCount: 0,
    });
  });

  it("uses a plural ok summary when multiple events are healthy", () => {
    const fresh = new Date(now.getTime() - 60_000);
    expect(
      evaluateBounceIngestHealth(
        [
          { enabled: true, last_run_at: fresh, last_run_ok: true },
          { enabled: true, last_run_at: fresh, last_run_ok: true },
        ],
        now,
        BOUNCE_INGEST_STALE_MS,
      ),
    ).toEqual({
      status: "ok",
      summary: "Automatic check ok · 2 events",
      enabledCount: 2,
      problemCount: 0,
    });
  });

  it("uses a singular degraded summary for one problem event", () => {
    expect(
      evaluateBounceIngestHealth(
        [{ enabled: true, last_run_at: null, last_run_ok: null }],
        now,
      ),
    ).toEqual({
      status: "degraded",
      summary: "1 event needs attention",
      enabledCount: 1,
      problemCount: 1,
    });
  });

  it("returns degraded when last run failed, is missing, or is stale vs 2x Check every", () => {
    const staleForFiveMin = new Date(now.getTime() - BOUNCE_INGEST_STALE_MS - 1);
    const fresh = new Date(now.getTime() - 60_000);
    expect(
      evaluateBounceIngestHealth(
        [
          { enabled: true, last_run_at: null, last_run_ok: null, poll_interval_minutes: 5 },
          { enabled: true, last_run_at: fresh, last_run_ok: false, poll_interval_minutes: 5 },
          { enabled: true, last_run_at: staleForFiveMin, last_run_ok: true, poll_interval_minutes: 5 },
          { enabled: false, last_run_at: null, last_run_ok: null },
        ],
        now,
      ),
    ).toEqual({
      status: "degraded",
      summary: "3 events need attention",
      enabledCount: 3,
      problemCount: 3,
    });
  });
});
