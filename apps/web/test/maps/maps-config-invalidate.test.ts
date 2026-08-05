import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  connect,
  publish,
  subscribe,
  close,
  on,
  createClient,
} = vi.hoisted(() => {
  const connect = vi.fn(async () => undefined);
  const publish = vi.fn(async () => 1);
  const subscribe = vi.fn(async (_channel: string, _cb: () => void) => undefined);
  const close = vi.fn(async () => undefined);
  const on = vi.fn();
  const createClient = vi.fn(() => ({
    isReady: false,
    isOpen: true,
    on,
    connect,
    publish,
    subscribe,
    close,
  }));
  return { connect, publish, subscribe, close, on, createClient };
});

vi.mock("redis", () => ({ createClient }));

import {
  defaultGeocodingConfig,
  defaultMapTileConfig,
  isMapsConfigCacheStale,
  setMapsConfigCache,
} from "../../src/maps/config.js";
import {
  MAPS_CONFIG_INVALIDATE_CHANNEL,
  publishMapsConfigInvalidation,
  startMapsConfigInvalidationSubscriber,
  stopMapsConfigInvalidationForTests,
} from "../../src/maps/maps-config-invalidate.js";

const prodRedis = {
  NODE_ENV: "production",
  REDIS_URL: "redis://127.0.0.1:6379",
};

afterEach(async () => {
  await stopMapsConfigInvalidationForTests();
  setMapsConfigCache(null);
  vi.clearAllMocks();
  createClient.mockImplementation(() => ({
    isReady: false,
    isOpen: true,
    on,
    connect,
    publish,
    subscribe,
    close,
  }));
});

beforeEach(() => {
  createClient.mockClear();
  connect.mockClear();
  publish.mockClear();
  subscribe.mockClear();
});

describe("publishMapsConfigInvalidation", () => {
  it("no-ops in test env even when REDIS_URL is set", async () => {
    await publishMapsConfigInvalidation({
      NODE_ENV: "test",
      REDIS_URL: "redis://127.0.0.1:6379",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("no-ops when REDIS_URL is missing", async () => {
    await publishMapsConfigInvalidation({ NODE_ENV: "production" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("connects and publishes on the invalidate channel", async () => {
    await publishMapsConfigInvalidation(prodRedis);
    expect(createClient).toHaveBeenCalled();
    expect(connect).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(MAPS_CONFIG_INVALIDATE_CHANNEL, "1");
  });

  it("warns and does not throw when publish fails", async () => {
    connect.mockRejectedValueOnce(new Error("redis down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(publishMapsConfigInvalidation(prodRedis)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("startMapsConfigInvalidationSubscriber", () => {
  it("marks the maps config cache stale when a message arrives", async () => {
    setMapsConfigCache({
      tiles: defaultMapTileConfig(),
      geocoding: defaultGeocodingConfig(),
    });
    expect(isMapsConfigCacheStale({ MAPS_CONFIG_CACHE_TTL_MS: "60000" })).toBe(false);

    subscribe.mockImplementationOnce(async (_channel: string, cb: () => void) => {
      cb();
    });

    startMapsConfigInvalidationSubscriber(prodRedis);
    await vi.waitFor(() => {
      expect(subscribe).toHaveBeenCalled();
    });
    expect(isMapsConfigCacheStale({ MAPS_CONFIG_CACHE_TTL_MS: "60000" })).toBe(true);
  });

  it("is idempotent for a second start in the same process", async () => {
    startMapsConfigInvalidationSubscriber(prodRedis);
    await vi.waitFor(() => expect(createClient).toHaveBeenCalledTimes(1));
    startMapsConfigInvalidationSubscriber(prodRedis);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("resets the started flag when subscribe fails so a later start can retry", async () => {
    connect.mockRejectedValueOnce(new Error("no redis"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    startMapsConfigInvalidationSubscriber(prodRedis);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();

    createClient.mockClear();
    connect.mockResolvedValue(undefined);
    startMapsConfigInvalidationSubscriber(prodRedis);
    await vi.waitFor(() => expect(createClient).toHaveBeenCalledTimes(1));
  });
});
