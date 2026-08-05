import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import {
  defaultGeocodingConfig,
  defaultMapTileConfig,
  setMapsConfigCache,
  getMapsConfigCache,
  markMapsConfigCacheStale,
} from "../../src/maps/config.js";
import {
  patchMapsSettings,
  refreshMapsConfigCache,
  refreshMapsConfigCacheIfStale,
  MAPS_SETTINGS_KEY,
} from "../../src/maps/maps-org-settings.js";

vi.mock("../../src/maps/maps-config-invalidate.js", () => ({
  publishMapsConfigInvalidation: vi.fn(async () => undefined),
}));

afterEach(() => {
  setMapsConfigCache(null);
  vi.restoreAllMocks();
});

function fakeDb(storedJson: string | null = null): PrismaClient {
  const row = storedJson == null ? null : { key: MAPS_SETTINGS_KEY, value_json: storedJson };
  return {
    systemSettings: {
      findUnique: vi.fn(async () => row),
      upsert: vi.fn(async () => row),
    },
    $transaction: vi.fn(async (fn: (tx: PrismaClient) => Promise<unknown>) => {
      const tx = {
        systemSettings: {
          findUnique: vi.fn(async () => row),
          upsert: vi.fn(async ({ update }: { update: { value_json: string } }) => {
            row && (row.value_json = update.value_json);
            return row;
          }),
        },
      } as unknown as PrismaClient;
      return fn(tx);
    }),
  } as unknown as PrismaClient;
}

describe("refreshMapsConfigCacheIfStale", () => {
  it("returns the in-memory cache when still fresh", async () => {
    setMapsConfigCache({
      tiles: { ...defaultMapTileConfig(), enabled: false },
      geocoding: defaultGeocodingConfig(),
    });
    const db = fakeDb(JSON.stringify({ enabled: true }));
    const result = await refreshMapsConfigCacheIfStale(db, {
      MAPS_CONFIG_CACHE_TTL_MS: "60000",
    });
    expect(result.tiles.enabled).toBe(false);
    expect(db.systemSettings.findUnique).not.toHaveBeenCalled();
  });

  it("re-reads SystemSettings when the cache is stale", async () => {
    setMapsConfigCache({
      tiles: { ...defaultMapTileConfig(), enabled: false },
      geocoding: defaultGeocodingConfig(),
    });
    markMapsConfigCacheStale();
    const db = fakeDb(JSON.stringify({ enabled: true }));
    const result = await refreshMapsConfigCacheIfStale(db, {
      MAPS_CONFIG_CACHE_TTL_MS: "60000",
    });
    expect(result.tiles.enabled).toBe(true);
    expect(db.systemSettings.findUnique).toHaveBeenCalled();
  });
});

describe("patchMapsSettings", () => {
  it("persists inside a transaction and refreshes the process cache", async () => {
    const db = fakeDb(JSON.stringify({ enabled: true }));
    const publicSettings = await patchMapsSettings(db, {
      enabled: false,
      tileUrl: "https://tiles.example.com/{z}/{x}/{y}.png",
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(publicSettings.enabled).toBe(false);
    expect(publicSettings.tileUrl).toBe("https://tiles.example.com/{z}/{x}/{y}.png");
    expect(getMapsConfigCache()?.tiles.enabled).toBe(false);
  });
});

describe("refreshMapsConfigCache", () => {
  it("keeps the previous cache when SystemSettings read throws", async () => {
    setMapsConfigCache({
      tiles: { ...defaultMapTileConfig(), enabled: false },
      geocoding: defaultGeocodingConfig(),
    });
    const db = {
      systemSettings: {
        findUnique: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
    } as unknown as PrismaClient;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await refreshMapsConfigCache(db);
    expect(result.tiles.enabled).toBe(false);
    spy.mockRestore();
  });
});
