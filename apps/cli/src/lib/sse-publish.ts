/**
 * Best-effort SSE announcements from the worker process (ADR 0044). The worker has no HTTP/SSE
 * connections of its own - it just tells apps/web's Redis-subscribed sse-channel that an event's
 * overview changed, so any connected admin session refreshes within ~3s instead of waiting for
 * the 30s poll. A missing REDIS_URL or a connection failure is a silent no-op: the 30s poll still
 * catches up, so this must never fail (or slow down) the actual mail/import drain it follows.
 */
import { createClient, type RedisClientType } from "redis";
import { sseChannelName } from "@admitto/shared/sse-events";

const CONNECT_TIMEOUT_MS = 2_000;

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType | null> | null = null;

async function ensureClient(url: string): Promise<RedisClientType | null> {
  if (client) return client;
  connecting ??= (async () => {
    const c = createClient({ url, socket: { connectTimeout: CONNECT_TIMEOUT_MS } });
    // Required by node-redis — unhandled 'error' events can crash the process.
    c.on("error", () => {});
    await c.connect();
    client = c as RedisClientType;
    return client;
  })().catch((err) => {
    connecting = null;
    console.warn(`worker SSE publish: Redis connection failed, announcements skipped: ${String(err)}`);
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
      c.publish(sseChannelName(eventId), JSON.stringify({ type: "activity_changed" })).catch(() => {
        /* best-effort */
      }),
    ),
  );
}

/** @internal test helper */
export async function closeSsePublishClientForTests(): Promise<void> {
  if (client?.isOpen) await client.quit();
  client = null;
  connecting = null;
}
