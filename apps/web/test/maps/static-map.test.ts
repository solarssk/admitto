import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  assertSafeTileFetchUrl,
  bufferLooksLikePng,
  buildStaticMapCacheKey,
  isAllowedDeclaredTileSize,
  latLngToTileFraction,
  plainMapAttribution,
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

describe("assertSafeTileFetchUrl", () => {
  it("allows https public hosts and blocks private or metadata targets", () => {
    expect(() => assertSafeTileFetchUrl("https://tiles.example/0/0/0.png")).not.toThrow();
    expect(() => assertSafeTileFetchUrl("http://169.254.169.254/latest")).toThrow(/https/);
    expect(() => assertSafeTileFetchUrl("https://169.254.169.254/latest")).toThrow(/blocked/);
    expect(() => assertSafeTileFetchUrl("https://127.0.0.1/tile.png")).toThrow(/blocked/);
    expect(() => assertSafeTileFetchUrl("https://192.168.1.10/tile.png")).toThrow(/blocked/);
  });

  it("allows http://localhost only in development", () => {
    expect(() =>
      assertSafeTileFetchUrl("http://localhost:8080/tile.png", { NODE_ENV: "development" }),
    ).not.toThrow();
    expect(() =>
      assertSafeTileFetchUrl("http://localhost:8080/tile.png", { NODE_ENV: "production" }),
    ).toThrow(/https/);
  });
});

describe("bufferLooksLikePng", () => {
  it("accepts real PNG signatures and rejects other payloads", async () => {
    const tile = await solidTilePng({ r: 1, g: 2, b: 3 });
    expect(bufferLooksLikePng(tile)).toBe(true);
    expect(bufferLooksLikePng(Buffer.from("not-a-png"))).toBe(false);
    expect(bufferLooksLikePng(Buffer.alloc(4))).toBe(false);
  });
});


describe("latLngToTileFraction", () => {
  it("maps the equator/prime meridian near the world center at zoom 1", () => {
    const { x, y } = latLngToTileFraction(0, 0, 1);
    expect(x).toBeCloseTo(1, 5);
    expect(y).toBeCloseTo(1, 5);
  });
});

describe("isAllowedDeclaredTileSize", () => {
  it("accepts finite sizes within the cap", () => {
    expect(isAllowedDeclaredTileSize(0, 512)).toBe(true);
    expect(isAllowedDeclaredTileSize(512, 512)).toBe(true);
  });

  it("rejects non-finite, negative, and oversize values", () => {
    expect(isAllowedDeclaredTileSize(Number.NaN, 512)).toBe(false);
    expect(isAllowedDeclaredTileSize(Number.POSITIVE_INFINITY, 512)).toBe(false);
    expect(isAllowedDeclaredTileSize(-1, 512)).toBe(false);
    expect(isAllowedDeclaredTileSize(513, 512)).toBe(false);
  });
});

describe("renderStaticMapPng content-length accept path", () => {
  it("reads the body when Content-Length is present and within the cap", async () => {
    const tile = await solidTilePng({ r: 40, g: 50, b: 60 });
    const fetchFn = vi.fn().mockImplementation(async () =>
      new Response(tile, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(tile.byteLength),
        },
      }),
    );
    const png = await renderStaticMapPng(
      { latitude: 52.23, longitude: 21.01, zoom: 14, width: 256, height: 256 },
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
    );
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
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

  it("rejects when Content-Length alone exceeds the cap before reading", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-length" ? String(600 * 1024) : null,
      },
      body: {
        cancel,
        getReader: () => {
          throw new Error("should not read body after oversize Content-Length");
        },
      },
    });
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
          fetchFn: fetchFn as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("declared") });
    expect(cancel).toHaveBeenCalled();
  });

  it("rejects streamed bodies that cross the cap without Content-Length", async () => {
    const chunk = new Uint8Array(200 * 1024);
    const fetchFn = vi.fn().mockImplementation(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(0)); // skipped empty chunk
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.enqueue(chunk); // 600 KiB total > 512 KiB cap
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "image/png" } });
    });
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

  it("wraps unexpected body-read errors", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => {
            throw new Error("socket reset");
          },
          cancel: async () => undefined,
        }),
      },
    });
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
          fetchFn: fetchFn as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("Tile read failed") });
  });

  it("cancels the response body on non-OK tile HTTP status", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      body: { cancel },
    });
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
          fetchFn: fetchFn as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("Tile HTTP 502") });
    expect(cancel).toHaveBeenCalled();
  });

  it("rejects empty tile bodies and network failures", async () => {
    const emptyBody = vi.fn().mockResolvedValue(
      new Response(null, { status: 200, headers: { "content-type": "image/png" } }),
    );
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
          fetchFn: emptyBody,
        },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("empty body") });

    const boom = vi.fn().mockRejectedValue(new Error("dns"));
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
          fetchFn: boom,
        },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("Tile fetch failed") });
  });

  it("clamps non-finite zoom and skips attribution overlay when credit is blank", async () => {
    const tile = await solidTilePng({ r: 100, g: 110, b: 120 });
    const fetchFn = vi.fn().mockImplementation(
      async () =>
        new Response(new Uint8Array(tile), { status: 200, headers: { "content-type": "image/png" } }),
    );
    const png = await renderStaticMapPng(
      { latitude: 0, longitude: 0, zoom: Number.NaN },
      {
        tileConfig: {
          enabled: true,
          tileUrl: "https://tiles.example/{z}/{x}/{y}.png",
          attribution: "   ",
          maxZoom: 19,
        },
        userAgent: "Admitto/test",
        fetchFn,
      },
    );
    expect(fetchFn).toHaveBeenCalled();
    expect((await sharp(png).metadata()).width).toBe(STATIC_MAP_WIDTH);
  });

  it("rejects when no tiles cover the viewport (out-of-range mercator y)", async () => {
    const fetchFn = vi.fn();
    await expect(
      renderStaticMapPng(
        // Far past Web Mercator limits → tile Y is negative / >= n and every tile is skipped.
        { latitude: 89.9, longitude: 0, zoom: 2 },
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
    ).rejects.toMatchObject({ message: expect.stringContaining("No map tiles") });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects non-finite Content-Length before reading the body", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-length" ? "not-a-number" : null),
      },
      body: {
        cancel,
        getReader: () => {
          throw new Error("should not read body after invalid Content-Length");
        },
      },
    });
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
          fetchFn: fetchFn as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("declared") });
    expect(cancel).toHaveBeenCalled();
  });

  it("rejects negative Content-Length before reading the body", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-length" ? "-1" : null),
      },
      body: {
        cancel,
        getReader: () => {
          throw new Error("should not read body after negative Content-Length");
        },
      },
    });
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
          fetchFn: fetchFn as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("declared") });
    expect(cancel).toHaveBeenCalled();
  });

  it("rejects non-PNG tile bodies before sharp composite", async () => {
    const fetchFn = vi.fn().mockImplementation(async () =>
      new Response(Buffer.from("not-a-valid-png"), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
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
    ).rejects.toMatchObject({ message: expect.stringContaining("not a PNG") });
  });

  it("rejects redirects to private or metadata hosts", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockResolvedValue({
      status: 302,
      ok: false,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "location" ? "https://169.254.169.254/latest/meta-data" : null,
      },
      body: { cancel },
    });
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
          fetchFn: fetchFn as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("blocked") });
    expect(cancel).toHaveBeenCalled();
  });

  it("follows a safe https redirect and composites the final PNG", async () => {
    const tile = await solidTilePng({ r: 70, g: 80, b: 90 });
    const fetchFn = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const href = String(input);
      if (href.includes("tiles.example")) {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://cdn.example/final.png" },
        });
      }
      return new Response(tile, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    const png = await renderStaticMapPng(
      { latitude: 52.23, longitude: 21.01, zoom: 14, width: 256, height: 256 },
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
    );
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(fetchFn.mock.calls.some((call) => String(call[0]).includes("cdn.example"))).toBe(true);
  });

  it("wraps sharp composite failures for corrupt PNG payloads", async () => {
    // Valid PNG signature, but truncated / garbage IHDR so sharp still fails.
    const corrupt = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("not-a-valid-png-chunk"),
    ]);
    const fetchFn = vi.fn().mockImplementation(async () =>
      new Response(corrupt, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
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
    ).rejects.toMatchObject({ message: expect.stringContaining("Failed to composite") });
  });

  it("uses global fetch when fetchFn is omitted", async () => {
    const tile = await solidTilePng({ r: 10, g: 20, b: 30 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(tile, { status: 200, headers: { "content-type": "image/png" } }),
    );
    try {
      const png = await renderStaticMapPng(
        { latitude: 52.23, longitude: 21.01, zoom: 14, width: 256, height: 256 },
        {
          tileConfig: {
            enabled: true,
            tileUrl: "https://tiles.example/{z}/{x}/{y}.png",
            attribution: "",
            maxZoom: 19,
          },
          userAgent: "Admitto/test",
        },
      );
      expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("plainMapAttribution", () => {
  it("strips tags while keeping link text and decodes &copy;", () => {
    expect(plainMapAttribution("&copy; OpenStreetMap")).toBe("© OpenStreetMap");
    expect(
      plainMapAttribution(
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      ),
    ).toBe("© OpenStreetMap contributors © CARTO");
    expect(plainMapAttribution('x <script>y</script>')).toBe("x y");
    expect(plainMapAttribution("  ")).toBe("");
  });
});
