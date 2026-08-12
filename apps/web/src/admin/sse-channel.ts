// SSE channels per event, local delivery to this process's own HTTP connections plus optional
// Redis pub/sub cross-process fan-out (ADR 0044) so the apps/cli worker - a separate process with
// no SSE connections of its own - can announce events too (mail drain, import drain). Mirrors
// createRateLimitStore's own gate: Redis in every non-test runtime with REDIS_URL set, in-process
// only otherwise, so the existing test suite never needs a real Redis just to exercise
// publish/subscribe. A Redis outage (or NODE_ENV=test) degrades to local-only delivery, never a
// crash or a stall - same fail-open philosophy, and the same reconnectStrategy:false + bounded
// command timeout, as RedisRateLimitStore/RedisTtlStringCache: this must never make a local
// publish() wait on a hung Redis, since a subscriber in this same process already has the
// listener it needs.
import { createClient, type RedisClientType } from "redis";
import { recordSystemLog } from "@admitto/shared/system-log";
import {
  eventIdFromSseChannel,
  sseChannelName,
  SSE_CHANNEL_PATTERN,
  type SseEvent,
} from "@admitto/shared/sse-events";

export type { SseEvent } from "@admitto/shared/sse-events";

type SseListener = (event: SseEvent) => void;

const channels = new Map<string, Set<SseListener>>();

const CONNECT_TIMEOUT_MS = 2_000;
const COMMAND_TIMEOUT_MS = 2_000;
const OUTAGE_COOLDOWN_MS = 5_000;
const FAIL_OPEN_LOG_INTERVAL_MS = 60_000;

function dispatchLocal(eventId: string, event: SseEvent): void {
  const listeners = channels.get(eventId);
  if (!listeners) return;
  for (const cb of listeners) {
    cb(event);
  }
}

/** Whether cross-process fan-out should be attempted. Exported for tests covering the gate logic
 * itself without needing a real Redis. */
export function shouldUseRedisSse(env: Record<string, string | undefined> = process.env): boolean {
  const url = env["REDIS_URL"]?.trim();
  return env["NODE_ENV"] !== "test" && !!url && isSafeRedisSseUrl(url);
}

/** SSE payloads can include attendee data. Redis on the bundled Compose network (the `redis`
 * service) and loopback are local-only; every other deployment must use TLS. */
function isSafeRedisSseUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === "rediss:") return true;
  if (url.protocol !== "redis:") return false;

  const host = url.hostname.toLowerCase();
  return host === "localhost" || host === "redis" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

let redisPub: RedisClientType | null = null;
let redisSub: RedisClientType | null = null;
let redisConnecting: Promise<void> | null = null;
let redisUnavailableUntil = 0;
let lastFailOpenWarnAt = 0;

function warnFailOpen(message: string): void {
  const now = Date.now();
  if (now - lastFailOpenWarnAt < FAIL_OPEN_LOG_INTERVAL_MS) return;
  lastFailOpenWarnAt = now;
  console.warn(message);
  recordSystemLog({ level: "warn", source: "cache", message });
}

/** Drops both connections and opens a short cooldown before the next reconnect attempt (mirrors
 * RedisRateLimitStore's own outage cooldown) - called whenever either client turns out to be
 * broken, whether detected via a failed command or an async 'error' event after a healthy
 * connect. Never awaited: cleanup is best-effort, the caller must not block on it. */
function dropRedisConnection(reason: string): void {
  redisUnavailableUntil = Date.now() + OUTAGE_COOLDOWN_MS;
  const pub = redisPub;
  const sub = redisSub;
  redisPub = null;
  redisSub = null;
  redisConnecting = null;
  warnFailOpen(`${reason}, falling back to in-process fan-out for ${OUTAGE_COOLDOWN_MS}ms`);
  pub?.destroy();
  sub?.destroy();
}

function createSseRedisClient(url: string): RedisClientType {
  const client = createClient({
    url,
    socket: {
      connectTimeout: CONNECT_TIMEOUT_MS,
      // No automatic reconnect: a client stuck retrying would otherwise queue commands and never
      // reject, so publish()/subscribe() could wait indefinitely on a downed Redis instead of
      // falling back to local delivery immediately. dropRedisConnection() below is what actually
      // recovers - on the next call, after the cooldown, a fresh pair connects from scratch.
      reconnectStrategy: false,
    },
    disableOfflineQueue: true,
  });
  // Required by node-redis — unhandled 'error' events can crash the process. A drop here (e.g.
  // Redis restarts mid-session, after a healthy connect) also needs to un-stick this module's
  // state so the next publish/subscribe call reconnects instead of talking to a dead client.
  client.on("error", () => {
    if (redisPub !== client && redisSub !== client) return;
    dropRedisConnection("SSE Redis connection dropped");
  });
  return client as RedisClientType;
}

/** Lazily connects a dedicated subscriber + publisher pair on first use (a client in pub/sub
 * subscribe mode can't also run PUBLISH, hence two connections). Best-effort: any failure just
 * keeps fan-out local to this process, same as before Redis support existed. */
async function ensureRedisConnected(): Promise<void> {
  if (!shouldUseRedisSse() || redisPub) return;
  if (Date.now() < redisUnavailableUntil) return;
  if (redisConnecting) {
    await redisConnecting;
    return;
  }

  const url = process.env["REDIS_URL"]!.trim();
  const sub = createSseRedisClient(url);
  const pub = createSseRedisClient(url);
  redisConnecting = (async () => {
    await Promise.all([sub.connect(), pub.connect()]);
    await sub.pSubscribe(SSE_CHANNEL_PATTERN, (message, channel) => {
      const eventId = eventIdFromSseChannel(channel);
      if (!eventId) return;
      try {
        dispatchLocal(eventId, JSON.parse(message) as SseEvent);
      } catch {
        /* ignore malformed payload */
      }
    });
    redisSub = sub;
    redisPub = pub;
  })().catch((err) => {
    // Either connect or pSubscribe can fail after its peer succeeded. These clients have not
    // reached the module state yet, so dropRedisConnection() cannot see and close them.
    sub.destroy();
    pub.destroy();
    redisConnecting = null;
    redisUnavailableUntil = Date.now() + OUTAGE_COOLDOWN_MS;
    warnFailOpen(`SSE Redis connection failed: ${String(err)}`);
  });
  await redisConnecting;
}

/** @internal Integration-test readiness hook; production callers should rely on local fallback. */
export async function waitForSseRedisReadyForTests(): Promise<boolean> {
  await ensureRedisConnected();
  return !!redisPub?.isReady && !!redisSub?.isReady;
}

export function subscribe(eventId: string, cb: SseListener): () => void {
  void ensureRedisConnected();

  let listeners = channels.get(eventId);
  if (!listeners) {
    listeners = new Set();
    channels.set(eventId, listeners);
  }
  listeners.add(cb);

  return () => {
    const set = channels.get(eventId);
    if (!set) return;
    set.delete(cb);
    if (set.size === 0) {
      channels.delete(eventId);
    }
  };
}

export function publish(eventId: string, event: SseEvent): void {
  // isReady is false whenever the client isn't currently usable (still connecting, or dropped
  // and awaiting its cooldown) - deliver locally immediately rather than attempting (and waiting
  // on) a command that can't succeed yet. This is what actually keeps a same-process publish
  // instant during a Redis outage: reconnectStrategy:false plus this check means publish() never
  // hands a message to a client that would just queue it and wait to reconnect.
  if (redisPub?.isReady) {
    const pub = redisPub;
    void pub
      .withAbortSignal(AbortSignal.timeout(COMMAND_TIMEOUT_MS))
      .publish(sseChannelName(eventId), JSON.stringify(event))
      .catch((err) => {
        dropRedisConnection(`SSE Redis publish failed (${String(err)})`);
        dispatchLocal(eventId, event);
      });
    return;
  }
  dispatchLocal(eventId, event);
}

export function subscriberCount(eventId: string): number {
  return channels.get(eventId)?.size ?? 0;
}

/** Test-only: reset all channels and any Redis connection state. */
export function resetSseChannelsForTests(): void {
  channels.clear();
  redisPub?.destroy();
  redisSub?.destroy();
  redisPub = null;
  redisSub = null;
  redisConnecting = null;
  redisUnavailableUntil = 0;
  lastFailOpenWarnAt = 0;
}
