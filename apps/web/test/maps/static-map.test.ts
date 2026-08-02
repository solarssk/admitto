import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  buildStaticMapCacheKey,
  latLngToTileFraction,
  renderStaticMapPng,
  STATIC_MAP_HEIGHT,
  STATIC_MAP_WIDTH,
  StaticMapRenderError,
} from "../../src/maps/static-map.js";

async function solidTilePng(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width: 256, height: 256, channels: 3, background: color },
  })
    .png()
    .toBuffer();
}

describe("latLngToTileFraction", () => {
  it("maps the equator/prime meridian near the world center at zoom 1", () => {
    const { x, y } = latLngToTileFraction(0, 0, 1);
    expect(x).toBeCloseTo(1, 5);
    expect(y).toBeCloseTo(1, 5);
  });
});

describe("buildStaticMapCacheKey", () => {
  it("changes when coordinates, tile URL, or attribution change", () => {
    const base = {
      latitude: 52.23,
      longitude: 21.01,
      zoom: 15,
    };
    const a = buildStaticMapCacheKey("evt1", base, "https://tiles.example/{z}/{x}/{y}.png", "© A");
    const b = buildStaticMapCacheKey(
      "evt1",
      { ...base, latitude: 52.24 },
      "https://tiles.example/{z}/{x}/{y}.png",
      "© A",
    );
    const c = buildStaticMapCacheKey("evt1", base, "https://other.example/{z}/{x}/{y}.png", "© A");
    const d = buildStaticMapCacheKey("evt1", base, "https://tiles.example/{z}/{x}/{y}.png", "© B");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).toHaveLength(64);
  });
});

describe("renderStaticMapPng", () => {
  it("composites mocked tiles into a PNG of the requested size", async () => {
    const tile = await solidTilePng({ r: 180, g: 190, b: 200 });
    const fetchFn = vi.fn().mockImplementation(async () =>
      new Response(new Uint8Array(tile), { status: 200, headers: { "content-type": "image/png" } }),
    );

    const png = await renderStaticMapPng(
      { latitude: 52.2297, longitude: 21.0122, zoom: 15 },
      {
        tileConfig: {
          enabled: true,
          tileUrl: "https://tiles.example/{z}/{x}/{y}.png",
          attribution: "© Test",
          maxZoom: 19,
        },
        userAgent: "Admitto/test",
        fetchFn,
      },
    );

    expect(fetchFn).toHaveBeenCalled();
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(STATIC_MAP_WIDTH);
    expect(meta.height).toBe(STATIC_MAP_HEIGHT);
    expect(meta.format).toBe("png");
  });

  it("rejects when maps are disabled", async () => {
    await expect(
      renderStaticMapPng(
        { latitude: 1, longitude: 2, zoom: 10 },
        {
          tileConfig: {
            enabled: false,
            tileUrl: "https://tiles.example/{z}/{x}/{y}.png",
            attribution: "",
            maxZoom: 19,
          },
          userAgent: "Admitto/test",
        },
      ),
    ).rejects.toBeInstanceOf(StaticMapRenderError);
  });

  it("surfaces tile HTTP failures", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("nope", { status: 503 }));
    await expect(
      renderStaticMapPng(
        { latitude: 52.23, longitude: 21.01, zoom: 14 },
        {
          tileConfig: {
            enabled: true,
            tileUrl: "https://tiles.example/{z}/{x}/{y}.png",
            attribution: "",
            maxZoom: 19,
          },
          userAgent: "Admitto/test",
          fetchFn,
        },
      ),
    ).rejects.toBeInstanceOf(StaticMapRenderError);
  });

  it("rejects oversized tiles without buffering the full body", async () => {
    const oversize = new Uint8Array(600 * 1024);
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(oversize, {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(oversize.byteLength) },
      }),
    );
    await expect(
      renderStaticMapPng(
        { latitude: 52.23, longitude: 21.01, zoom: 14 },
        {
          tileConfig: {
            enabled: true,
            tileUrl: "https://tiles.example/{z}/{x}/{y}.png",
            attribution: "© Test",
            maxZoom: 19,
          },
          userAgent: "Admitto/test",
          fetchFn,
        },
      ),
    ).rejects.toBeInstanceOf(StaticMapRenderError);
  });
});
