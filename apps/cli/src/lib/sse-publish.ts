/**
 * Best-effort SSE announcements from the worker process (ADR 0044). The worker has no HTTP/SSE
 * connections of its own - it just tells apps/web's Redis-subscribed sse-channel that an event's
 * overview changed, so any connected admin session refreshes within ~3s instead of waiting for
 * the 30s poll. A missing REDIS_URL, a connection failure, or a slow/unresponsive Redis is a
 * bounded no-op: the 30s poll still catches up, so this must never fail *or stall* the mail/import
 * drain tick it follows - both jobs await this while still holding their worker advisory lock, so
 * an unbounded wait here would stall the rest of that tick (export, bounce, retention, heartbeat)
 * behind it. Same reconnectStrategy:false + bounded command timeout + outage cooldown as
 * apps/web's sse-channel and RedisRateLimitStore.
 */
import { createClient, type RedisClientType } from "redis";
import { sseChannelName } from "@admitto/shared/sse-events";

const CONNECT_TIMEOUT_MS = 2_000;
const COMMAND_TIMEOUT_MS = 2_000;
const OUTAGE_COOLDOWN_MS = 5_000;

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType | null> | null = null;
let unavailableUntil = 0;

function dropClient(reason: string): void {
  unavailableUntil = Date.now() + OUTAGE_COOLDOWN_MS;
  const dead = client;
  client = null;
  connecting = null;
  console.warn(`worker SSE publish: ${reason}, announcements paused for ${OUTAGE_COOLDOWN_MS}ms`);
  dead?.destroy();
}

async function ensureClient(url: string): Promise<RedisClientType | null> {
  if (client?.isReady) return client;
  if (Date.now() < unavailableUntil) return null;
  if (connecting) return connecting;

  connecting = (async () => {
    const c = createClient({
      url,
      // No automatic reconnect - a retrying client would queue commands instead of rejecting,
      // which is exactly the unbounded wait this module must never produce (see file header).
      socket: { connectTimeout: CONNECT_TIMEOUT_MS, reconnectStrategy: false },
      disableOfflineQueue: true,
    });
    // Required by node-redis — unhandled 'error' events can crash the process. A drop here (e.g.
    // Redis restarts mid-session) also needs to un-stick module state for the next call.
    c.on("error", () => {
      if (client !== c) return;
      dropClient("Redis connection dropped");
    });
    await c.connect();
    client = c;
    return client;
  })().catch((err) => {
    dropClient(`Redis connection failed (${String(err)})`);
    return null;
  });
  return connecting;
}

/** Announces `activity_changed` for each event id, e.g. after a mail or import drain tick. */
export async function publishActivityChanged(eventIds: readonly string[]): Promise<void> {
  const url = process.env["REDIS_URL"]?.trim();
  if (!url || eventIds.length === 0) return;

  const c = await ensureClient(url);
  if (!c) return;

  await Promise.all(
    eventIds.map((eventId) =>
      c
        .withAbortSignal(AbortSignal.timeout(COMMAND_TIMEOUT_MS))
        .publish(sseChannelName(eventId), JSON.stringify({ type: "activity_changed" }))
        .catch((err) => {
          dropClient(`publish failed (${String(err)})`);
        }),
    ),
  );
}

/** Closes the publisher connection, if open. Call on worker shutdown (an open socket otherwise
 * keeps the process alive past a SIGTERM/SIGINT) and from tests between cases. */
export async function closeSsePublishClient(): Promise<void> {
  // Shutdown must not wait on a Redis server that is itself unavailable.
  client?.destroy();
  client = null;
  connecting = null;
  unavailableUntil = 0;
}
