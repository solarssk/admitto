import { describe, expect, it, vi } from "vitest";
import type { IngestSummary } from "../../src/bounceIngest/types.js";
import {
  BOUNCE_INGEST_STALE_MS,
  bounceIngestStaleMsFromIntervalSeconds,
  evaluateBounceIngestHealth,
  lastRunOkFromSummary,
  lastRunSummaryFromIngest,
  persistBounceIngestLastRun,
  parseBounceIngestIntervalSeconds,
  serializeBounceIngestLastRun,
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
  it("writes last_run_* on the event settings row", async () => {
    const update = vi.fn().mockResolvedValue({});
    const db = { bounceIngestSettings: { update } } as never;
    const ranAt = new Date("2026-08-06T12:00:00.000Z");

    await persistBounceIngestLastRun(db, "evt_1", summary({ errors: 1, connectFailed: true }), ranAt);

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
  });
});

describe("bounceIngestStaleMsFromIntervalSeconds", () => {
  it("floors short intervals at BOUNCE_INGEST_STALE_MS", () => {
    expect(bounceIngestStaleMsFromIntervalSeconds(300)).toBe(BOUNCE_INGEST_STALE_MS);
    expect(bounceIngestStaleMsFromIntervalSeconds(null)).toBe(BOUNCE_INGEST_STALE_MS);
  });

  it("uses 2× interval when longer than the floor", () => {
    expect(bounceIngestStaleMsFromIntervalSeconds(3600)).toBe(7_200_000);
  });
});

describe("parseBounceIngestIntervalSeconds", () => {
  it("defaults to 300 and rejects non-positive values", () => {
    expect(parseBounceIngestIntervalSeconds({})).toBe(300);
    expect(parseBounceIngestIntervalSeconds({ BOUNCE_INGEST_INTERVAL_SECONDS: "0" })).toBe(300);
    expect(parseBounceIngestIntervalSeconds({ BOUNCE_INGEST_INTERVAL_SECONDS: "abc" })).toBe(300);
    expect(parseBounceIngestIntervalSeconds({ BOUNCE_INGEST_INTERVAL_SECONDS: "3600" })).toBe(3600);
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
        [{ enabled: true, last_run_at: fresh, last_run_ok: true }],
        now,
        BOUNCE_INGEST_STALE_MS,
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

  it("keeps hourly deploy intervals healthy within 2× the interval", () => {
    const hourlyStale = bounceIngestStaleMsFromIntervalSeconds(3600);
    expect(hourlyStale).toBe(2 * 3600 * 1000);
    const almostStale = new Date(now.getTime() - hourlyStale + 60_000);
    expect(
      evaluateBounceIngestHealth(
        [{ enabled: true, last_run_at: almostStale, last_run_ok: true }],
        now,
        hourlyStale,
      ),
    ).toMatchObject({ status: "ok" });
    const stale = new Date(now.getTime() - hourlyStale - 1);
    expect(
      evaluateBounceIngestHealth(
        [{ enabled: true, last_run_at: stale, last_run_ok: true }],
        now,
        hourlyStale,
      ),
    ).toMatchObject({ status: "degraded", problemCount: 1 });
  });

  it("returns degraded when last run failed, is missing, or is stale", () => {
    const stale = new Date(now.getTime() - BOUNCE_INGEST_STALE_MS - 1);
    const fresh = new Date(now.getTime() - 60_000);
    expect(
      evaluateBounceIngestHealth(
        [
          { enabled: true, last_run_at: null, last_run_ok: null },
          { enabled: true, last_run_at: fresh, last_run_ok: false },
          { enabled: true, last_run_at: stale, last_run_ok: true },
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
