import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { EventStaticMapService } from "../../src/maps/event-static-map-service.js";
import type { StaticMapCache } from "../../src/maps/static-map-cache.js";
import { StaticMapRenderError } from "../../src/maps/static-map.js";

const SAMPLE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

function fakeCache(initial: Record<string, Buffer> = {}): StaticMapCache & {
  store: Record<string, Buffer>;
} {
  const store = { ...initial };
  return {
    store,
    get: vi.fn(async (key: string) => store[key] ?? null),
    set: vi.fn(async (key: string, png: Buffer) => {
      store[key] = png;
    }),
  };
}

function fakeDb(location: {
  latitude: number | null;
  longitude: number | null;
  map_zoom: number;
} | null): PrismaClient {
  return {
    event: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id === "missing") return null;
        return {
          id: where.id,
          location_details: location,
        };
      }),
    },
  } as unknown as PrismaClient;
}

describe("EventStaticMapService.getForEvent", () => {
  it("returns disabled when LOCATION_MAPS_ENABLED=false", async () => {
    const prev = process.env["LOCATION_MAPS_ENABLED"];
    process.env["LOCATION_MAPS_ENABLED"] = "false";
    try {
      const service = new EventStaticMapService({ cache: fakeCache() });
      await expect(
        service.getForEvent(fakeDb({ latitude: 1, longitude: 2, map_zoom: 15 }), "evt"),
      ).resolves.toEqual({
        ok: false,
        reason: "disabled",
      });
    } finally {
      if (prev === undefined) delete process.env["LOCATION_MAPS_ENABLED"];
      else process.env["LOCATION_MAPS_ENABLED"] = prev;
    }
  });

  it("returns not_found when the event is missing", async () => {
    const service = new EventStaticMapService({ cache: fakeCache() });
    await expect(
      service.getForEvent(fakeDb({ latitude: 1, longitude: 2, map_zoom: 15 }), "missing"),
    ).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("returns no_coordinates when the event has no pin", async () => {
    const service = new EventStaticMapService({ cache: fakeCache() });
    await expect(service.getForEvent(fakeDb(null), "evt")).resolves.toEqual({
      ok: false,
      reason: "no_coordinates",
    });
    await expect(
      service.getForEvent(fakeDb({ latitude: 52.2, longitude: null, map_zoom: 15 }), "evt"),
    ).resolves.toEqual({ ok: false, reason: "no_coordinates" });
  });

  it("returns a cache hit without rendering", async () => {
    const cache = fakeCache();
    cache.get = vi.fn(async () => SAMPLE_PNG);
    const renderPng = vi.fn(async () => {
      throw new Error("should not render");
    });
    const service = new EventStaticMapService({
      cache,
      renderPng,
      buildUserAgent: async () => "Admitto/test",
    });

    const result = await service.getForEvent(
      fakeDb({ latitude: 52.2297, longitude: 21.0122, map_zoom: 15 }),
      "evt-hit",
    );
    expect(result).toEqual({ ok: true, png: SAMPLE_PNG, cacheHit: true });
    expect(renderPng).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("renders, caches, and returns a miss on first request", async () => {
    const cache = fakeCache();
    const renderPng = vi.fn(async () => SAMPLE_PNG);
    const service = new EventStaticMapService({
      cache,
      renderPng,
      buildUserAgent: async () => "Admitto/test",
    });

    const result = await service.getForEvent(
      fakeDb({ latitude: 52.2297, longitude: 21.0122, map_zoom: 14 }),
      "evt-miss",
    );
    expect(result).toEqual({ ok: true, png: SAMPLE_PNG, cacheHit: false });
    expect(renderPng).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), SAMPLE_PNG);
  });

  it("maps StaticMapRenderError to render_failed", async () => {
    const service = new EventStaticMapService({
      cache: fakeCache(),
      renderPng: vi.fn(async () => {
        throw new StaticMapRenderError("boom");
      }),
      buildUserAgent: async () => "Admitto/test",
    });

    await expect(
      service.getForEvent(fakeDb({ latitude: 1, longitude: 2, map_zoom: 10 }), "evt"),
    ).resolves.toEqual({ ok: false, reason: "render_failed" });
  });

  it("coalesces concurrent cold-cache renders for the same key", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const renderPng = vi.fn(async () => {
      await gate;
      return SAMPLE_PNG;
    });
    const service = new EventStaticMapService({
      cache: fakeCache(),
      renderPng,
      buildUserAgent: async () => "Admitto/test",
    });
    const db = fakeDb({ latitude: 1, longitude: 2, map_zoom: 10 });

    const first = service.getForEvent(db, "evt");
    const second = service.getForEvent(db, "evt");
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(a).toEqual({ ok: true, png: SAMPLE_PNG, cacheHit: false });
    expect(b).toEqual({ ok: true, png: SAMPLE_PNG, cacheHit: false });
    expect(renderPng).toHaveBeenCalledTimes(1);
  });
});
