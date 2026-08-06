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

/** Deploy loop default when env is unset (matches bounce-ingest-loop.sh). */
const DEFAULT_BOUNCE_INGEST_INTERVAL_SECONDS = 300;

/**
 * Soft-health stale window from the deploy bounce-ingest interval.
 * Uses 2× the interval so a successful run stays healthy until the next scheduled tick
 * (and a little slack for runtime), floored at {@link BOUNCE_INGEST_STALE_MS}.
 */
export function bounceIngestStaleMsFromIntervalSeconds(
  intervalSeconds: number | null | undefined,
): number {
  const seconds =
    typeof intervalSeconds === "number" && Number.isFinite(intervalSeconds) && intervalSeconds > 0
      ? Math.floor(intervalSeconds)
      : DEFAULT_BOUNCE_INGEST_INTERVAL_SECONDS;
  return Math.max(BOUNCE_INGEST_STALE_MS, seconds * 2 * 1000);
}

/** Parse `BOUNCE_INGEST_INTERVAL_SECONDS` for soft-health stale windows. */
export function parseBounceIngestIntervalSeconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env["BOUNCE_INGEST_INTERVAL_SECONDS"];
  if (raw === undefined || raw === "") return DEFAULT_BOUNCE_INGEST_INTERVAL_SECONDS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BOUNCE_INGEST_INTERVAL_SECONDS;
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

export async function persistBounceIngestLastRun(
  db: PrismaClient,
  eventId: string,
  summary: IngestSummary,
  ranAt: Date = new Date(),
): Promise<void> {
  const ok = lastRunOkFromSummary(summary);
  const last_run_summary = lastRunSummaryFromIngest(summary) as Prisma.InputJsonValue;
  await db.bounceIngestSettings.update({
    where: { event_id: eventId },
    data: {
      last_run_at: ranAt,
      last_run_ok: ok,
      last_run_summary,
    },
  });
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
  staleMs: number = BOUNCE_INGEST_STALE_MS,
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
