type EnvLike = Record<string, string | undefined>;

/**
 * Operator-tunable limits for the check-in live-updates SSE stream
 * (`GET /api/checkin/events/:eventId/stream`). Two separate mechanisms:
 *
 * - request rate limit (`rateLimit*`, `rateLimitWindowMs`): how many stream *requests*
 *   (connects and reconnects) one actor may make per window. Enforced by the `checkin:stream`
 *   policy in `rate-limit/policies.ts`.
 * - concurrency (`maxConcurrent*`): how many stream connections one actor may hold *open at
 *   once*. Enforced by `checkin-stream-limit.ts`.
 */
export interface CheckinStreamLimits {
  /** Stream requests per window, per actor + event. */
  rateLimitPerEvent: number;
  /** Stream requests per window, per actor across all events. */
  rateLimitPerActor: number;
  /** Rate-limit window length (ms), shared by both request limits above. */
  rateLimitWindowMs: number;
  /** Simultaneously open streams, per actor + event. */
  maxConcurrentPerEvent: number;
  /** Simultaneously open streams, per actor across all events. */
  maxConcurrentPerActor: number;
}

/** Defaults sized for phones on flaky Wi-Fi/LTE and reverse proxies, where one healthy client
 * can reconnect a stream many times a minute. The concurrency defaults are deliberately
 * unchanged: they bound parallel connections, which reconnect churn does not inflate. */
export const DEFAULT_CHECKIN_STREAM_LIMITS: Readonly<CheckinStreamLimits> = {
  rateLimitPerEvent: 120,
  rateLimitPerActor: 240,
  rateLimitWindowMs: 60_000,
  maxConcurrentPerEvent: 3,
  maxConcurrentPerActor: 12,
};

/** Positive base-10 integer or `undefined`. Stricter than `Number.parseInt`, which would accept
 * `"12abc"` as 12 and `"1.5"` as 1 - a typo'd limit must not silently become a different one. */
function parsePositiveInteger(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Unset or blank uses the default silently; anything else that is not a positive integer uses
 * the default with a boot warning naming the variable, so a typo is visible instead of quietly
 * loosening or tightening a protection. */
function readLimit(env: EnvLike, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = parsePositiveInteger(raw);
  if (parsed !== undefined) return parsed;
  console.warn(`${name} must be a positive integer (got: "${raw}"); using default ${fallback}.`);
  return fallback;
}

/** Resolve the stream limits from ENV. Read once at process start (see
 * {@link CHECKIN_STREAM_LIMITS}); changing a value needs a restart, not a rebuild. */
export function resolveCheckinStreamLimits(env: EnvLike = process.env): CheckinStreamLimits {
  const d = DEFAULT_CHECKIN_STREAM_LIMITS;
  return {
    rateLimitPerEvent: readLimit(env, "CHECKIN_STREAM_RATE_LIMIT_PER_EVENT", d.rateLimitPerEvent),
    rateLimitPerActor: readLimit(env, "CHECKIN_STREAM_RATE_LIMIT_PER_ACTOR", d.rateLimitPerActor),
    rateLimitWindowMs: readLimit(env, "CHECKIN_STREAM_RATE_LIMIT_WINDOW_MS", d.rateLimitWindowMs),
    maxConcurrentPerEvent: readLimit(
      env,
      "CHECKIN_STREAM_MAX_CONCURRENT_PER_EVENT",
      d.maxConcurrentPerEvent,
    ),
    maxConcurrentPerActor: readLimit(
      env,
      "CHECKIN_STREAM_MAX_CONCURRENT_PER_ACTOR",
      d.maxConcurrentPerActor,
    ),
  };
}

/** Process-wide limits, resolved once when this module first loads (i.e. at app start). */
export const CHECKIN_STREAM_LIMITS: Readonly<CheckinStreamLimits> = resolveCheckinStreamLimits();
