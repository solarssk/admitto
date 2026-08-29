import { createClient } from "redis";
import { emitSystemLog } from "@admitto/shared/system-log";

/**
 * Global pacing gate for outbound PassCreator calls (ADR 0041 §3: 600 req/min, account-wide).
 *
 * A purely in-process gate (module-level "next allowed timestamp") only bounds one OS process -
 * but the standard deployment runs `app` and `worker` as separate containers
 * (deploy/docker-compose.yml), and both independently call PassCreator (admin wallet actions in
 * `app`; wallet-push/wallet-sync/wallet-message jobs in `worker`). Two independently-paced
 * processes can each stay under their own budget and still sum to roughly double the real
 * account-wide limit (bot review, PR #1064 round 3). This module coordinates the pace across
 * every process via Redis when `REDIS_URL` is configured (the same connection info already
 * required for rate limiting and session storage in this deployment), and falls back to the
 * simple in-process gate otherwise - correct for a single-process deployment, and a same-class
 * fail-open (not fail-closed) if Redis becomes unreachable, matching
 * `apps/web/src/rate-limit/redis.ts`'s established trade-off for exactly this kind of shared
 * limiter: a temporary coordination gap under a Redis outage, not blocking wallet operations
 * entirely.
 *
 * Scope note: this bounds the *default* single-`app`-replica + single-`worker`-replica topology
 * (`worker: deploy: replicas: 1` is enforced by its own session-advisory-lock design;
 * `deploy/docker-compose.yml`'s bundled `app` service has no compose-level replica cap, but
 * horizontal scaling of `app` is not part of the documented default topology - "No HA /
 * multi-region failover in the default compose topology" per
 * docs/security/SECURITY-CONTROLS.md's Known scope limits). Redis coordination here is what makes
 * even 2 separate containers (app + worker) correct; a deployment that also scales `app` to N
 * replicas divides this same shared budget across N+1 processes instead of the assumed 2, which
 * only lowers each process's effective share - it does not reopen the over-limit risk this fixes,
 * since every process still draws from the one shared Redis-tracked budget.
 */

/** Redis-tracked window: at most this many PassCreator calls admitted per WINDOW_MS,
 * account-wide, across every process sharing this Redis instance. 6/window (windowMs=1000) =
 * 360/min - a real, comfortable margin under PassCreator's 600/min limit, leaving headroom for
 * clock/network jitter between processes and for the polling granularity below. */
const WINDOW_MS = 1_000;
const MAX_PER_WINDOW = 6;
/** How often a call that lost the race for this window's slots re-checks. Small relative to
 * WINDOW_MS so a caller doesn't overshoot into the next window by much once one opens up. */
const POLL_INTERVAL_MS = 40;
const CONNECT_TIMEOUT_MS = 2_000;
const COMMAND_TIMEOUT_MS = 2_000;
const OUTAGE_COOLDOWN_MS = 5_000;
const FAIL_OPEN_WARN = "PassCreator pace-gate Redis unavailable; pacing this process locally only";
const FAIL_OPEN_LOG_INTERVAL_MS = 60_000;

/** Same technique as apps/web/src/rate-limit/redis.ts's INCR_PEXPIRE_SCRIPT (atomic
 * increment-and-expire-on-create), reused here rather than imported - packages/wallet must not
 * depend on apps/web (apps/cli's worker depends on packages/wallet, never on apps/web; see
 * resolve-provider.ts). */
const INCR_PEXPIRE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PaceRedisClient = ReturnType<typeof createClient>;

let client: PaceRedisClient | null = null;
let connectPromise: Promise<void> | null = null;
let redisUnavailableUntil = 0;
let lastFailOpenWarnAt = 0;

function getOrCreateClient(url: string): PaceRedisClient {
  if (client) return client;
  client = createClient({
    url,
    socket: { connectTimeout: CONNECT_TIMEOUT_MS, reconnectStrategy: false },
  });
  // Required by node-redis - unhandled 'error' events can crash the process (same requirement as
  // apps/web/src/rate-limit/redis.ts's own client).
  client.on("error", () => {});
  return client;
}

async function ensureConnected(c: PaceRedisClient): Promise<void> {
  if (c.isReady) return;
  connectPromise ??= c
    .connect()
    .then(() => undefined)
    .finally(() => {
      connectPromise = null;
    });
  await connectPromise;
  if (!c.isReady) throw new Error("Redis client not ready");
}

function warnFailOpen(now: number): void {
  if (now - lastFailOpenWarnAt >= FAIL_OPEN_LOG_INTERVAL_MS) {
    emitSystemLog("wallet", "warn", "passcreator_pace_gate_redis_unavailable", { detail: FAIL_OPEN_WARN });
    lastFailOpenWarnAt = now;
  }
}

/** One admitted-count check for the current fixed window. Returns null (fail open, caller should
 * use the local-only gate instead) on any Redis error or while in the outage cooldown. */
async function tryReserveDistributedSlot(url: string): Promise<boolean | null> {
  const now = Date.now();
  if (now < redisUnavailableUntil) return null;
  try {
    const c = getOrCreateClient(url);
    await ensureConnected(c);
    const windowKey = `passcreator:pace:${Math.floor(now / WINDOW_MS)}`;
    const count = Number(
      await c
        .withAbortSignal(AbortSignal.timeout(COMMAND_TIMEOUT_MS))
        .eval(INCR_PEXPIRE_SCRIPT, { keys: [windowKey], arguments: [String(WINDOW_MS)] }),
    );
    return count <= MAX_PER_WINDOW;
  } catch {
    redisUnavailableUntil = now + OUTAGE_COOLDOWN_MS;
    warnFailOpen(now);
    return null;
  }
}

/** Reserves the next admitted slot across every process sharing this Redis instance, waiting
 * (short poll) until one opens up in the current or a following window. Callers that get `null`
 * back from `tryReserveDistributedSlot` (Redis unavailable) should fall back to local-only
 * pacing instead of calling this in a tight loop against a Redis that isn't responding. */
export async function reservePassCreatorSlotDistributed(url: string): Promise<"reserved" | "fail-open"> {
  for (;;) {
    const admitted = await tryReserveDistributedSlot(url);
    if (admitted === null) return "fail-open";
    if (admitted) return "reserved";
    await sleep(POLL_INTERVAL_MS);
  }
}

/** @internal test-only - resets connection/outage state between test cases (this module's state
 * is a process-wide singleton, same class of gotcha as `resetMailSentThrottleForTest` /
 * `resetSystemLogBufferForTest` / `resetPassCreatorPacingForTest`). Does not disconnect an
 * already-open client - tests that construct their own client via a mock URL don't need a real
 * connection torn down. */
export function resetPassCreatorPaceGateForTest(): void {
  client = null;
  connectPromise = null;
  redisUnavailableUntil = 0;
  lastFailOpenWarnAt = 0;
}
