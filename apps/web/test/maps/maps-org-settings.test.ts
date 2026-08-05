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
  resolveEffectiveMapsConfig,
  describeMapsSettings,
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

  it("falls back to built-in settings when read throws and cache is empty", async () => {
    setMapsConfigCache(null);
    const db = {
      systemSettings: {
        findUnique: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
    } as unknown as PrismaClient;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await refreshMapsConfigCache(db);
    expect(result.tiles.enabled).toBe(true);
    expect(result.tiles.tileUrl).toContain("openstreetmap.org");
    spy.mockRestore();
  });
});

describe("resolveEffectiveMapsConfig / describeMapsSettings", () => {
  it("uses defaults when no SystemSettings row exists", async () => {
    const db = fakeDb(null);
    const effective = await resolveEffectiveMapsConfig(db);
    expect(effective.tiles.enabled).toBe(true);
    expect(effective.geocoding.baseUrl).toContain("nominatim");
  });

  it("ignores non-object stored JSON and incompatible field types", async () => {
    const asArray = await resolveEffectiveMapsConfig(fakeDb(JSON.stringify([1, 2, 3])));
    expect(asArray.tiles.enabled).toBe(true);

    const asPrimitive = await resolveEffectiveMapsConfig(fakeDb(JSON.stringify("maps")));
    expect(asPrimitive.tiles.maxZoom).toBe(defaultMapTileConfig().maxZoom);

    const badTypes = await resolveEffectiveMapsConfig(
      fakeDb(
        JSON.stringify({
          enabled: "yes",
          tileUrl: 12,
          maxZoom: "high",
          attribution: false,
          geocodingProvider: 9,
          geocodingBaseUrl: true,
        }),
      ),
    );
    expect(badTypes.tiles.enabled).toBe(true);
    expect(badTypes.tiles.tileUrl).toContain("openstreetmap.org");
  });

  it("falls back to defaults when the stored JSON is corrupt", async () => {
    const db = fakeDb("not-json{{{");
    const effective = await resolveEffectiveMapsConfig(db);
    expect(effective.tiles.enabled).toBe(true);
    expect(effective.tiles.tileUrl).toContain("openstreetmap.org");
  });

  it("applies stored fields including null clears", async () => {
    const db = fakeDb(
      JSON.stringify({
        enabled: false,
        tileUrl: null,
        attribution: "  ",
        maxZoom: 12,
        geocodingProvider: "nominatim",
        geocodingBaseUrl: "https://nominatim.example.com/",
      }),
    );
    const described = await describeMapsSettings(db);
    expect(described.enabled).toBe(false);
    expect(described.maxZoom).toBe(12);
    expect(described.geocodingBaseUrl).toBe("https://nominatim.example.com");
    expect(described.attribution).toContain("OpenStreetMap");
  });

  it("rejects incompatible stored tile URLs", async () => {
    const db = fakeDb(
      JSON.stringify({
        tileUrl: "http://tiles.internal.example/{z}/{x}/{y}.png",
      }),
    );
    const effective = await resolveEffectiveMapsConfig(db);
    expect(effective.tiles.tileUrl).toContain("openstreetmap.org");
  });
});

describe("patchMapsSettings clearing branches", () => {
  it("clears blank maxZoom, provider, and geocoding base URL to null", async () => {
    const row = {
      key: MAPS_SETTINGS_KEY,
      value_json: JSON.stringify({
        enabled: true,
        maxZoom: 19,
        geocodingProvider: "nominatim",
        geocodingBaseUrl: "https://nominatim.openstreetmap.org",
      }),
    };
    const db = {
      systemSettings: {
        findUnique: vi.fn(async () => row),
        upsert: vi.fn(async () => row),
      },
      $transaction: vi.fn(async (fn: (tx: PrismaClient) => Promise<unknown>) => {
        const tx = {
          systemSettings: {
            findUnique: vi.fn(async () => row),
            upsert: vi.fn(async ({ update }: { update: { value_json: string } }) => {
              row.value_json = update.value_json;
              return row;
            }),
          },
        } as unknown as PrismaClient;
        return fn(tx);
      }),
    } as unknown as PrismaClient;

    await patchMapsSettings(db, {
      maxZoom: 0,
      geocodingProvider: "  ",
      geocodingBaseUrl: "  ",
      attribution: "Custom",
    });
    const stored = JSON.parse(row.value_json) as {
      maxZoom: number | null;
      geocodingProvider: string | null;
      geocodingBaseUrl: string | null;
      attribution: string;
    };
    expect(stored.maxZoom).toBeNull();
    expect(stored.geocodingProvider).toBeNull();
    expect(stored.geocodingBaseUrl).toBeNull();
    expect(stored.attribution).toBe("Custom");
  });
});
