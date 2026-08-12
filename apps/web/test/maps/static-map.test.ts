import { describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { fetch as undiciFetch } from "undici";
import sharp from "sharp";
import {
  assertSafeTileFetchUrl,
  bufferLooksLikePng,
  buildStaticMapCacheKey,
  buildUnavailableStaticMapPng,
  isAllowedDeclaredTileSize,
  latLngToTileFraction,
  normalizeTilePngToCompositorSize,
  plainMapAttribution,
  redactTileUrlForLogs,
  renderStaticMapPng,
  STATIC_MAP_HEIGHT,
  STATIC_MAP_WIDTH,
  StaticMapRenderError,
} from "../../src/maps/static-map.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

vi.mock("undici", () => {
  function MockAgent(this: { close: () => Promise<void> }) {
    this.close = vi.fn().mockResolvedValue(undefined);
  }
  return {
    Agent: vi.fn(MockAgent),
    fetch: vi.fn(),
  };
});

const mockedLookup = vi.mocked(lookup);
const mockedUndiciFetch = vi.mocked(undiciFetch);

async function solidTilePng(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width: 256, height: 256, channels: 3, background: color },
  })
    .png()
    .toBuffer();
}

describe("redactTileUrlForLogs", () => {
  it("strips query strings and fragments that may hold API keys", () => {
    expect(
      redactTileUrlForLogs("https://tiles.example/16/1/2.png?api_key=super-secret&x=1"),
    ).toBe("https://tiles.example/16/1/2.png");
    expect(redactTileUrlForLogs("https://tiles.example/a.png#token=abc")).toBe(
      "https://tiles.example/a.png",
    );
  });

  it("falls back safely for unparseable input", () => {
    expect(redactTileUrlForLogs("not a url?api_key=leak")).toBe("not a url");
  });

  it("strips userinfo from unparseable credential-bearing URLs", () => {
    expect(redactTileUrlForLogs("https://user:secret@")).toBe("https://");
    expect(redactTileUrlForLogs("https://token@host.invalid/%")).not.toContain("token");
  });
});

describe("assertSafeTileFetchUrl", () => {
  it("allows https public hosts and blocks private or metadata targets", () => {
    expect(() => assertSafeTileFetchUrl("https://tiles.example/0/0/0.png")).not.toThrow();
    expect(() => assertSafeTileFetchUrl("http://169.254.169.254/latest")).toThrow(/https/);
    expect(() => assertSafeTileFetchUrl("https://169.254.169.254/latest")).toThrow(/blocked/);
    expect(() => assertSafeTileFetchUrl("https://127.0.0.1/tile.png")).toThrow(/blocked/);
    expect(() => assertSafeTileFetchUrl("https://192.168.1.10/tile.png")).toThrow(/blocked/);
  });

  it("rejects unparseable tile URLs without leaking query secrets", () => {
    expect(() => assertSafeTileFetchUrl("not a url?api_key=super-secret")).toThrow(
      /Invalid tile URL: not a url/,
    );
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
    const fetchFn = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      // Works around a Node process bug where an unrelated undici import elsewhere corrupts
      // global fetch's gzip decompression over HTTP/2 - see NO_COMPRESSION_HEADERS' doc comment.
      expect(init?.headers).toMatchObject({ "Accept-Encoding": "identity" });
      return new Response(tile, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(tile.byteLength),
        },
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
  });
});

describe("buildStaticMapCacheKey", () => {
  it("changes when burn-in attribution is toggled off for list previews", () => {
    const base = { latitude: 52.23, longitude: 21.01, zoom: 15 };
    const withBurn = buildStaticMapCacheKey(
      "evt1",
      base,
      "https://tiles.example/{z}/{x}/{y}.png",
      "© A",
      true,
    );
    const withoutBurn = buildStaticMapCacheKey(
      "evt1",
      base,
      "https://tiles.example/{z}/{x}/{y}.png",
      "© A",
      false,
    );
    expect(withBurn).not.toBe(withoutBurn);
  });

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

  it("skips the PNG attribution burn-in when burnInAttribution is false", async () => {
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
          attribution: "© Test Attribution That Would Burn In",
          maxZoom: 19,
        },
        userAgent: "Admitto/test",
        fetchFn,
        burnInAttribution: false,
      },
    );

    expect(fetchFn).toHaveBeenCalled();
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(STATIC_MAP_WIDTH);
  });

  it("resizes non-256 commercial tiles (e.g. MapTiler 512) before composite", async () => {
    const tile512 = await sharp({
      create: { width: 512, height: 512, channels: 3, background: { r: 100, g: 140, b: 180 } },
    })
      .png()
      .toBuffer();
    const fetchFn = vi.fn().mockImplementation(async () =>
      new Response(new Uint8Array(tile512), { status: 200, headers: { "content-type": "image/png" } }),
    );

    const png = await renderStaticMapPng(
      { latitude: 52.2297, longitude: 21.0122, zoom: 15 },
      {
        tileConfig: {
          enabled: true,
          tileUrl: "https://api.maptiler.example/maps/streets/{z}/{x}/{y}.png?key=test",
          attribution: "© MapTiler © OpenStreetMap",
          maxZoom: 19,
        },
        userAgent: "Admitto/test",
        fetchFn,
      },
    );

    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(STATIC_MAP_WIDTH);
    expect(meta.height).toBe(STATIC_MAP_HEIGHT);
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

  it("aborts outstanding sibling tile fetches when one tile fails", async () => {
    let siblingAborted = false;
    let calls = 0;
    const fetchFn = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        return new Response("fail", { status: 502 });
      }
      await new Promise<never>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("expected AbortSignal on sibling fetch"));
          return;
        }
        const fail = () => {
          siblingAborted = true;
          reject(new DOMException("The operation was aborted", "AbortError"));
        };
        if (signal.aborted) {
          fail();
          return;
        }
        signal.addEventListener("abort", fail, { once: true });
      });
    });

    await expect(
      renderStaticMapPng(
        { latitude: 52.2297, longitude: 21.0122, zoom: 15, width: 400, height: 400 },
        {
          tileConfig: {
            enabled: true,
            tileUrl: "https://tiles.example/{z}/{x}/{y}.png",
            attribution: "",
            maxZoom: 19,
          },
          userAgent: "Admitto/test",
          fetchFn,
          timeoutMs: 5_000,
        },
      ),
    ).rejects.toBeInstanceOf(StaticMapRenderError);

    expect(calls).toBeGreaterThan(1);
    expect(siblingAborted).toBe(true);
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

  it("cancels the response body on non-OK tile HTTP status without leaking query credentials", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      body: { cancel },
    });
    const rejected = renderStaticMapPng(
      { latitude: 52.23, longitude: 21.01, zoom: 14 },
      {
        tileConfig: {
          enabled: true,
          tileUrl: "https://tiles.example/{z}/{x}/{y}.png?api_key=secret-token",
          attribution: "",
          maxZoom: 19,
        },
        userAgent: "Admitto/test",
        fetchFn: fetchFn as unknown as typeof fetch,
      },
    );
    await expect(rejected).rejects.toMatchObject({
      message: expect.stringMatching(/^Tile HTTP 502: https:\/\/tiles\.example\/\d+\/\d+\/\d+\.png$/),
    });
    await expect(rejected).rejects.not.toMatchObject({
      message: expect.stringContaining("secret-token"),
    });
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

  it("rejects a redirect response that omits Location", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockResolvedValue({
      status: 302,
      ok: false,
      headers: { get: () => null },
      body: { cancel },
    });
    await expect(
      renderStaticMapPng(
        { latitude: 52.23, longitude: 21.01, zoom: 14 },
        {
          tileConfig: {
            enabled: true,
            tileUrl: "https://tiles.example/{z}/{x}/{y}.png?api_key=secret",
            attribution: "",
            maxZoom: 19,
          },
          userAgent: "Admitto/test",
          fetchFn: fetchFn as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Tile redirect without Location: https:\/\/tiles\.example\//),
    });
    expect(cancel).toHaveBeenCalled();
  });

  it("rejects a redirect Location that cannot be parsed as a URL", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockResolvedValue({
      status: 302,
      ok: false,
      headers: {
        get: (name: string) => (name.toLowerCase() === "location" ? "http://[" : null),
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
    ).rejects.toMatchObject({ message: expect.stringContaining("Tile redirect to invalid URL") });
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
    ).rejects.toMatchObject({ message: expect.stringContaining("Tile PNG metadata unreadable") });
  });

  it("rejects tiles whose decoded dimensions exceed the compositor safety cap", async () => {
    const oversized = await sharp({
      create: { width: 2049, height: 256, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const fetchFn = vi.fn().mockImplementation(async () =>
      new Response(oversized, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    await expect(
      renderStaticMapPng(
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
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("Tile PNG dimensions too large") });
  });

  it("rejects tile PNGs whose metadata omits width/height", async () => {
    const fakeImage = (() => ({
      metadata: async () => ({ format: "png" }),
    })) as unknown as typeof sharp;

    await expect(
      normalizeTilePngToCompositorSize(
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        "https://tiles.example/0/0/0.png",
        fakeImage,
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("Tile PNG has no dimensions") });
  });

  it("wraps tile resize failures after non-256 metadata succeeds", async () => {
    const fakeImage = (() => ({
      metadata: async () => ({ format: "png", width: 512, height: 512 }),
      resize: () => ({
        png: () => ({
          toBuffer: async () => {
            throw new Error("resize boom");
          },
        }),
      }),
    })) as unknown as typeof sharp;

    await expect(
      normalizeTilePngToCompositorSize(
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        "https://tiles.example/0/0/0.png?api_key=secret",
        fakeImage,
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Tile PNG resize failed: https:\/\/tiles\.example\/0\/0\/0\.png$/),
    });
  });

  it("wraps final canvas composite failures after tiles load", async () => {
    const tile = await solidTilePng({ r: 10, g: 20, b: 30 });
    const fetchFn = vi.fn().mockImplementation(async () =>
      new Response(new Uint8Array(tile), { status: 200, headers: { "content-type": "image/png" } }),
    );
    const fakeImage = ((input: unknown, opts?: unknown) => {
      if (input && typeof input === "object" && "create" in (input as object)) {
        return {
          composite() {
            throw new Error("composite boom");
          },
          png() {
            return this;
          },
          async toBuffer() {
            throw new Error("composite boom");
          },
        };
      }
      return sharp(input as Parameters<typeof sharp>[0], opts as Parameters<typeof sharp>[1]);
    }) as unknown as typeof sharp;

    await expect(
      renderStaticMapPng(
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
          imagePipeline: fakeImage,
        },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("Failed to composite static map") });
  });

  describe("without a fetchFn override (production DNS pinning)", () => {
    it("pins the connection to a resolved address instead of using global fetch", async () => {
      const tile = await solidTilePng({ r: 10, g: 20, b: 30 });
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      mockedLookup.mockResolvedValue([
        { address: "1.2.3.4", family: 4 },
      ] as unknown as Awaited<ReturnType<typeof lookup>>);
      mockedUndiciFetch.mockImplementation(
        async () =>
          new Response(tile, {
            status: 200,
            headers: { "content-type": "image/png" },
          }) as unknown as Awaited<ReturnType<typeof undiciFetch>>,
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
        expect(mockedLookup).toHaveBeenCalled();
        expect(mockedUndiciFetch).toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("follows a safe redirect and re-resolves/re-pins the new hop", async () => {
      const tile = await solidTilePng({ r: 7, g: 8, b: 9 });
      mockedLookup.mockResolvedValue([
        { address: "1.2.3.4", family: 4 },
      ] as unknown as Awaited<ReturnType<typeof lookup>>);
      mockedUndiciFetch.mockImplementation(async (url) => {
        const requested = String(url);
        if (!requested.includes("cdn-tiles.example")) {
          const redirected = requested.replace("tiles.example", "cdn-tiles.example");
          return new Response(null, {
            status: 302,
            headers: { location: redirected },
          }) as unknown as Awaited<ReturnType<typeof undiciFetch>>;
        }
        return new Response(tile, {
          status: 200,
          headers: { "content-type": "image/png" },
        }) as unknown as Awaited<ReturnType<typeof undiciFetch>>;
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
        },
      );
      expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      // Each hop is independently re-resolved and re-pinned, not just the tile's first attempt.
      expect(mockedLookup.mock.calls.length).toBeGreaterThan(1);
    });

    it("rejects a redirect to a blocked/private host", async () => {
      mockedLookup.mockResolvedValue([
        { address: "1.2.3.4", family: 4 },
      ] as unknown as Awaited<ReturnType<typeof lookup>>);
      mockedUndiciFetch.mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest" },
        }) as unknown as Awaited<ReturnType<typeof undiciFetch>>,
      );
      await expect(
        renderStaticMapPng(
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
        ),
      ).rejects.toThrow(/blocked/);
    });
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

describe("buildUnavailableStaticMapPng", () => {
  it("returns a PNG at the static map dimensions", async () => {
    const png = await buildUnavailableStaticMapPng();
    expect(bufferLooksLikePng(png)).toBe(true);
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(STATIC_MAP_WIDTH);
    expect(meta.height).toBe(STATIC_MAP_HEIGHT);
    const again = await buildUnavailableStaticMapPng();
    expect(again).toBe(png);
  });
});
