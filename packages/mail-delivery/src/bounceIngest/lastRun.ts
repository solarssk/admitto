import type { Prisma, PrismaClient } from "@admitto/db";
import type { IngestSummary } from "./types.js";

/** Compact per-event snapshot stored on BounceIngestSettings.last_run_summary. */
export type BounceIngestLastRunSummary = {
  messagesSeen: number;
  bouncesApplied: number;
  softBouncesLogged: number;
  unparsed: number;
  noMatchingDelivery: number;
  errors: number;
  connectFailed: boolean;
};

/** API / UI shape for last automatic check. */
export type BounceIngestLastRunDto = BounceIngestLastRunSummary & {
  at: string;
  ok: boolean;
};

/** Soft health: enabled configs with last_run older than this are stale (floor). */
export const BOUNCE_INGEST_STALE_MS = 15 * 60 * 1000;

const DEFAULT_POLL_INTERVAL_MINUTES = 5;
const DEFAULT_BOUNCE_INGEST_TICK_SECONDS = 60;

/** True when this event should run on the current bounce-ingest tick. */
export function isBounceIngestDue(
  row: {
    last_run_at: Date | null;
    last_run_ok: boolean | null;
    poll_interval_minutes: number | null;
  },
  now: Date = new Date(),
): boolean {
  if (row.last_run_at == null) return true;
  // Failed runs retry on the next global tick; poll interval applies only after success.
  if (row.last_run_ok !== true) return true;
  const minutes =
    row.poll_interval_minutes != null && row.poll_interval_minutes > 0
      ? row.poll_interval_minutes
      : DEFAULT_POLL_INTERVAL_MINUTES;
  return now.getTime() - row.last_run_at.getTime() >= minutes * 60_000;
}

/** Per-event stale window for soft health: 2× Check every, floored at BOUNCE_INGEST_STALE_MS. */
export function bounceIngestStaleMsForPoll(pollIntervalMinutes: number | null | undefined): number {
  const minutes =
    pollIntervalMinutes != null && pollIntervalMinutes > 0
      ? pollIntervalMinutes
      : DEFAULT_POLL_INTERVAL_MINUTES;
  return Math.max(BOUNCE_INGEST_STALE_MS, minutes * 2 * 60_000);
}

/**
 * Soft-health stale contribution from the deploy wake tick
 * (`BOUNCE_INGEST_TICK_SECONDS`, or legacy `BOUNCE_INGEST_INTERVAL_SECONDS`).
 * 2× tick, floored at {@link BOUNCE_INGEST_STALE_MS}.
 */
export function bounceIngestStaleMsFromIntervalSeconds(
  intervalSeconds: number | null | undefined,
): number {
  const seconds =
    typeof intervalSeconds === "number" && Number.isFinite(intervalSeconds) && intervalSeconds > 0
      ? Math.floor(intervalSeconds)
      : DEFAULT_BOUNCE_INGEST_TICK_SECONDS;
  return Math.max(BOUNCE_INGEST_STALE_MS, seconds * 2 * 1000);
}

/** Parse deploy wake tick; prefers TICK, then legacy INTERVAL, default 60. */
export function parseBounceIngestTickSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["BOUNCE_INGEST_TICK_SECONDS"] ?? env["BOUNCE_INGEST_INTERVAL_SECONDS"];
  if (raw === undefined || raw === "") return DEFAULT_BOUNCE_INGEST_TICK_SECONDS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BOUNCE_INGEST_TICK_SECONDS;
}

/** Combined soft-health stale window for one event (Check every and deploy tick). */
export function bounceIngestStaleMsForEvent(
  pollIntervalMinutes: number | null | undefined,
  deployTickSeconds: number | null | undefined,
): number {
  return Math.max(
    bounceIngestStaleMsForPoll(pollIntervalMinutes),
    bounceIngestStaleMsFromIntervalSeconds(deployTickSeconds),
  );
}

export function lastRunOkFromSummary(summary: IngestSummary): boolean {
  return !summary.connectFailed && summary.errors === 0;
}

export function lastRunSummaryFromIngest(summary: IngestSummary): BounceIngestLastRunSummary {
  return {
    messagesSeen: summary.messagesSeen,
    bouncesApplied: summary.bouncesApplied,
    softBouncesLogged: summary.softBouncesLogged,
    unparsed: summary.unparsed,
    noMatchingDelivery: summary.noMatchingDelivery,
    errors: summary.errors,
    connectFailed: summary.connectFailed,
  };
}

/** How many BounceIngestRun rows to keep per event. */
export const BOUNCE_INGEST_RUN_HISTORY_LIMIT = 20;

export async function persistBounceIngestLastRun(
  db: PrismaClient,
  eventId: string,
  summary: IngestSummary,
  ranAt: Date = new Date(),
): Promise<void> {
  const ok = lastRunOkFromSummary(summary);
  const last_run_summary = lastRunSummaryFromIngest(summary) as Prisma.InputJsonValue;
  await db.$transaction(async (tx) => {
    await tx.bounceIngestSettings.update({
      where: { event_id: eventId },
      data: {
        last_run_at: ranAt,
        last_run_ok: ok,
        last_run_summary,
      },
    });
    await tx.bounceIngestRun.create({
      data: {
        event_id: eventId,
        ran_at: ranAt,
        ok,
        summary: last_run_summary,
      },
    });
    await pruneBounceIngestRunHistory(tx, eventId);
  });
}

/** Keep the newest N runs; delete older rows for this event. */
export async function pruneBounceIngestRunHistory(
  db: PrismaClient | Prisma.TransactionClient,
  eventId: string,
  keep: number = BOUNCE_INGEST_RUN_HISTORY_LIMIT,
): Promise<void> {
  const keepRows = await db.bounceIngestRun.findMany({
    where: { event_id: eventId },
    orderBy: { ran_at: "desc" },
    take: keep,
    select: { id: true },
  });
  if (keepRows.length < keep) return;
  const keepIds = keepRows.map((r) => r.id);
  await db.bounceIngestRun.deleteMany({
    where: {
      event_id: eventId,
      id: { notIn: keepIds },
    },
  });
}

/** List recent runs newest-first for the event settings API. */
export async function listBounceIngestRecentRuns(
  db: PrismaClient,
  eventId: string,
  take: number = BOUNCE_INGEST_RUN_HISTORY_LIMIT,
): Promise<BounceIngestLastRunDto[]> {
  const rows = await db.bounceIngestRun.findMany({
    where: { event_id: eventId },
    orderBy: { ran_at: "desc" },
    take,
  });
  return rows
    .map((row) => serializeBounceIngestLastRun(row.ran_at, row.ok, row.summary))
    .filter((dto): dto is BounceIngestLastRunDto => dto != null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonNegInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** Parse stored JSON (or null) into a DTO when last_run_at is present. */
export function serializeBounceIngestLastRun(
  lastRunAt: Date | null | undefined,
  lastRunOk: boolean | null | undefined,
  lastRunSummary: unknown,
): BounceIngestLastRunDto | null {
  if (!lastRunAt) return null;
  const raw = isRecord(lastRunSummary) ? lastRunSummary : {};
  return {
    at: lastRunAt.toISOString(),
    ok: lastRunOk === true,
    messagesSeen: readNonNegInt(raw.messagesSeen),
    bouncesApplied: readNonNegInt(raw.bouncesApplied),
    softBouncesLogged: readNonNegInt(raw.softBouncesLogged),
    unparsed: readNonNegInt(raw.unparsed),
    noMatchingDelivery: readNonNegInt(raw.noMatchingDelivery),
    errors: readNonNegInt(raw.errors),
    connectFailed: raw.connectFailed === true,
  };
}

export type BounceIngestHealthInput = {
  enabled: boolean;
  last_run_at: Date | null;
  last_run_ok: boolean | null;
  poll_interval_minutes?: number | null;
};

export type BounceIngestHealthResult = {
  status: "not_configured" | "ok" | "degraded";
  summary: string;
  enabledCount: number;
  problemCount: number;
};

/**
 * Aggregate soft health for Settings → Health (external group).
 * Does not affect /healthz or /readyz.
 */
export function evaluateBounceIngestHealth(
  rows: BounceIngestHealthInput[],
  now: Date = new Date(),
  deployTickSeconds: number | null | undefined = DEFAULT_BOUNCE_INGEST_TICK_SECONDS,
): BounceIngestHealthResult {
  const enabled = rows.filter((r) => r.enabled);
  if (enabled.length === 0) {
    return {
      status: "not_configured",
      summary: "Not configured",
      enabledCount: 0,
      problemCount: 0,
    };
  }

  let problemCount = 0;
  for (const row of enabled) {
    if (row.last_run_at == null || row.last_run_ok !== true) {
      problemCount += 1;
      continue;
    }
    const staleMs = bounceIngestStaleMsForEvent(row.poll_interval_minutes, deployTickSeconds);
    if (now.getTime() - row.last_run_at.getTime() > staleMs) {
      problemCount += 1;
    }
  }

  if (problemCount === 0) {
    return {
      status: "ok",
      summary:
        enabled.length === 1
          ? "Automatic check ok"
          : `Automatic check ok · ${enabled.length} events`,
      enabledCount: enabled.length,
      problemCount: 0,
    };
  }

  return {
    status: "degraded",
    summary:
      problemCount === 1
        ? "1 event needs attention"
        : `${problemCount} events need attention`,
    enabledCount: enabled.length,
    problemCount,
  };
}
