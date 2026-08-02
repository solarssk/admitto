/**
 * Shared Redis→in-memory fail-open TTL string store for maps caches (geocoding JSON,
 * static-map PNG base64). A Redis outage degrades to a miss, not a 500.
 */
import { createClient } from "redis";
import { recordSystemLog } from "@admitto/shared/system-log";

const DEFAULT_COMMAND_TIMEOUT_MS = 2_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
const FAIL_OPEN_LOG_INTERVAL_MS = 60_000;

export interface TtlStringCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** @internal test helper */
  disconnect?(): Promise<void>;
}

export class InMemoryTtlStringCache implements TtlStringCache {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

export class RedisTtlStringCache implements TtlStringCache {
  private readonly client: ReturnType<typeof createClient>;
  private readonly commandTimeoutMs: number;
  private readonly keyPrefix: string;
  private readonly failOpenWarn: string;
  private connectPromise: Promise<void> | null = null;
  private lastFailOpenWarnAt = 0;

  constructor(
    url: string,
    options: {
      keyPrefix: string;
      failOpenWarn: string;
      connectTimeoutMs?: number;
      commandTimeoutMs?: number;
    },
  ) {
    this.keyPrefix = options.keyPrefix;
    this.failOpenWarn = options.failOpenWarn;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.client = createClient({
      url,
      socket: {
        connectTimeout: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        reconnectStrategy: false,
      },
    });
    // Required by node-redis - unhandled 'error' events can crash the process.
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
      console.warn(this.failOpenWarn);
      recordSystemLog({ level: "warn", source: "cache", message: this.failOpenWarn });
      this.lastFailOpenWarnAt = now;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      await this.ensureConnected();
      const raw = await this.client
        .withAbortSignal(AbortSignal.timeout(this.commandTimeoutMs))
        .get(this.keyPrefix + key);
      return raw ?? null;
    } catch {
      this.warnFailOpen();
      return null;
    }
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    try {
      await this.ensureConnected();
      await this.client
        .withAbortSignal(AbortSignal.timeout(this.commandTimeoutMs))
        .set(this.keyPrefix + key, value, {
          expiration: { type: "PX", value: ttlMs },
        });
    } catch {
      this.warnFailOpen();
    }
  }

  async disconnect(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    }
    this.connectPromise = null;
  }
}
