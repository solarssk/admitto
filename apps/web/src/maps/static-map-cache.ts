/**
 * Cache for generated static map PNGs. Same Redis→in-memory fail-open shape as
 * `geocoding-cache.ts` — a Redis outage degrades to regenerating the image, not a 500.
 */
import { createClient } from "redis";
import { recordSystemLog } from "@admitto/shared/system-log";

type EnvLike = Record<string, string | undefined>;

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REDIS_KEY_PREFIX = "static-map:cache:";
const DEFAULT_COMMAND_TIMEOUT_MS = 2_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
const FAIL_OPEN_WARN = "Static map cache Redis unavailable; treating as cache miss";
const FAIL_OPEN_LOG_INTERVAL_MS = 60_000;

export interface StaticMapCache {
  get(key: string): Promise<Buffer | null>;
  set(key: string, png: Buffer): Promise<void>;
}

export class InMemoryStaticMapCache implements StaticMapCache {
  private readonly store = new Map<string, { png: Buffer; expiresAt: number }>();

  async get(key: string): Promise<Buffer | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.png;
  }

  async set(key: string, png: Buffer): Promise<void> {
    this.store.set(key, { png, expiresAt: Date.now() + TTL_MS });
  }
}

export class RedisStaticMapCache implements StaticMapCache {
  private readonly client: ReturnType<typeof createClient>;
  private readonly commandTimeoutMs: number;
  private connectPromise: Promise<void> | null = null;
  private lastFailOpenWarnAt = 0;

  constructor(
    url: string,
    options: { connectTimeoutMs?: number; commandTimeoutMs?: number } = {},
  ) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.client = createClient({
      url,
      socket: {
        connectTimeout: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        reconnectStrategy: false,
      },
    });
    this.client.on("error", () => {});
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isReady) return;
    this.connectPromise ??= this.client
      .connect()
      .then(() => undefined)
      .finally(() => {
        this.connectPromise = null;
      });
    await this.connectPromise;
    if (!this.client.isReady) {
      throw new Error("Redis client not ready");
    }
  }

  private warnFailOpen(): void {
    const now = Date.now();
    if (now - this.lastFailOpenWarnAt >= FAIL_OPEN_LOG_INTERVAL_MS) {
      console.warn(FAIL_OPEN_WARN);
      recordSystemLog({ level: "warn", source: "cache", message: FAIL_OPEN_WARN });
      this.lastFailOpenWarnAt = now;
    }
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      await this.ensureConnected();
      const raw = await this.client
        .withAbortSignal(AbortSignal.timeout(this.commandTimeoutMs))
        .get(REDIS_KEY_PREFIX + key);
      if (!raw) return null;
      return Buffer.from(raw, "base64");
    } catch {
      this.warnFailOpen();
      return null;
    }
  }

  async set(key: string, png: Buffer): Promise<void> {
    try {
      await this.ensureConnected();
      await this.client
        .withAbortSignal(AbortSignal.timeout(this.commandTimeoutMs))
        .set(REDIS_KEY_PREFIX + key, png.toString("base64"), {
          expiration: { type: "PX", value: TTL_MS },
        });
    } catch {
      this.warnFailOpen();
    }
  }

  /** @internal test helper */
  async disconnect(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
    this.connectPromise = null;
  }
}

export function createStaticMapCache(env: EnvLike = process.env): StaticMapCache {
  if (env["NODE_ENV"] === "test") {
    return new InMemoryStaticMapCache();
  }
  const url = env["REDIS_URL"]?.trim();
  if (url) {
    return new RedisStaticMapCache(url);
  }
  return new InMemoryStaticMapCache();
}
