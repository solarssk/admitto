// SSE channels per event, local delivery to this process's own HTTP connections plus optional
// Redis pub/sub cross-process fan-out (ADR 0044) so the apps/cli worker - a separate process with
// no SSE connections of its own - can announce events too (mail drain, import drain). Mirrors
// createRateLimitStore's own gate: Redis in every non-test runtime with REDIS_URL set, in-process
// only otherwise, so the existing test suite never needs a real Redis just to exercise
// publish/subscribe. A Redis outage (or NODE_ENV=test) degrades to local-only delivery, never a
// crash - same fail-open philosophy as RedisRateLimitStore/RedisTtlStringCache.
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
  return env["NODE_ENV"] !== "test" && !!env["REDIS_URL"]?.trim();
}

function createSseRedisClient(url: string): RedisClientType {
  const client = createClient({ url, socket: { connectTimeout: CONNECT_TIMEOUT_MS } });
  // Required by node-redis — unhandled 'error' events can crash the process.
  client.on("error", () => {});
  return client as RedisClientType;
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

  redisConnecting = (async () => {
    const url = process.env["REDIS_URL"]!.trim();
    const sub = createSseRedisClient(url);
    const pub = createSseRedisClient(url);
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
    redisConnecting = null;
    redisUnavailableUntil = Date.now() + OUTAGE_COOLDOWN_MS;
    warnFailOpen(`SSE Redis connection failed, falling back to in-process fan-out: ${String(err)}`);
  });
  await redisConnecting;
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
  if (redisPub) {
    void redisPub.publish(sseChannelName(eventId), JSON.stringify(event)).catch((err) => {
      warnFailOpen(`SSE Redis publish failed, delivering in-process only: ${String(err)}`);
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
  void redisPub?.quit().catch(() => {});
  void redisSub?.quit().catch(() => {});
  redisPub = null;
  redisSub = null;
  redisConnecting = null;
  redisUnavailableUntil = 0;
  lastFailOpenWarnAt = 0;
}
