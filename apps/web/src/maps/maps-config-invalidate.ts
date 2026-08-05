/**
 * Cross-process maps-settings invalidation via Redis pub/sub when REDIS_URL is set.
 * Processes that did not handle the save mark their in-memory cache stale and re-read
 * SystemSettings on the next ensure/refresh path.
 */

import { createClient } from "redis";
import { markMapsConfigCacheStale } from "./config.js";

export const MAPS_CONFIG_INVALIDATE_CHANNEL = "admitto:maps-config-invalidate";

type EnvLike = Record<string, string | undefined>;

let subscriber: ReturnType<typeof createClient> | null = null;
let publisher: ReturnType<typeof createClient> | null = null;
let subscribeStarted = false;

function redisUrl(env: EnvLike): string | null {
  if (env["NODE_ENV"] === "test") return null;
  const url = env["REDIS_URL"]?.trim();
  return url || null;
}

/** Publish after a successful maps settings save (best-effort; never throws). */
export async function publishMapsConfigInvalidation(
  env: EnvLike = process.env,
): Promise<void> {
  const url = redisUrl(env);
  if (!url) return;
  try {
    publisher ??= createClient({
      url,
      socket: { connectTimeout: 2_000, reconnectStrategy: false },
    });
    publisher.on("error", () => {});
    if (!publisher.isReady) await publisher.connect();
    await publisher.publish(MAPS_CONFIG_INVALIDATE_CHANNEL, "1");
  } catch (err) {
    console.warn("maps config invalidate publish failed:", err);
  }
}

/** Subscribe once per process at boot (best-effort; never throws). */
export function startMapsConfigInvalidationSubscriber(
  env: EnvLike = process.env,
): void {
  if (subscribeStarted) return;
  const url = redisUrl(env);
  if (!url) return;
  subscribeStarted = true;

  void (async () => {
    try {
      subscriber = createClient({
        url,
        socket: { connectTimeout: 2_000, reconnectStrategy: false },
      });
      subscriber.on("error", () => {});
      await subscriber.connect();
      await subscriber.subscribe(MAPS_CONFIG_INVALIDATE_CHANNEL, () => {
        markMapsConfigCacheStale();
      });
    } catch (err) {
      console.warn("maps config invalidate subscribe failed:", err);
      subscribeStarted = false;
      subscriber = null;
    }
  })();
}

/** @internal */
export async function stopMapsConfigInvalidationForTests(): Promise<void> {
  subscribeStarted = false;
  const sub = subscriber;
  const pub = publisher;
  subscriber = null;
  publisher = null;
  if (sub?.isOpen) await sub.close().catch(() => undefined);
  if (pub?.isOpen) await pub.close().catch(() => undefined);
}
