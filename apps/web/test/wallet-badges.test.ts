import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("wallet / ticket mark assets", () => {
  it("serves Admitto mark and official wallet badge SVGs", async () => {
    const app = createApp();
    const cases = [
      "/assets/admitto-mark.svg",
      "/assets/apple-wallet-badge.svg",
      "/assets/google-wallet-badge.svg",
    ];
    for (const path of cases) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toContain("image/svg+xml");
      expect(res.headers.get("x-content-type-options"), path).toBe("nosniff");
      const body = await res.text();
      expect(body.length, path).toBeGreaterThan(40);
      expect(body, path).toContain("<svg");
      // Second hit exercises the in-memory asset cache path.
      const cached = await app.request(path);
      expect(cached.status, path).toBe(200);
      expect(await cached.text()).toBe(body);
    }
  });

  it("does not serve unknown files under the wallet allowlist handlers", async () => {
    // Exact routes only - a random asset path is not registered here.
    const app = createApp();
    const res = await app.request("/assets/not-a-wallet-badge.svg");
    // Staff SPA catch-all or 404 depending on dist - must not return a forged SVG from wallet-badges.
    if (res.status === 200) {
      const type = res.headers.get("content-type") ?? "";
      expect(type.includes("image/svg+xml") && (await res.text()).includes("Add to Apple")).toBe(
        false,
      );
    }
  });
});

describe("GET /m/:filename", () => {
  it("returns 404 for non-png filenames and empty ids", async () => {
    const app = createApp({
      eventStaticMapService: {
        getForEvent: async () => ({ ok: false, reason: "not_found" }),
      },
    });
    expect((await app.request("/m/evt.jpg")).status).toBe(404);
    expect((await app.request("/m/.png")).status).toBe(404);
  });

  it("returns PNG bytes on success and maps failure reasons to status codes", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const appOk = createApp({
      eventStaticMapService: {
        getForEvent: async () => ({ ok: true, png, cacheHit: false }),
      },
    });
    const ok = await appOk.request("/m/evt_1.png");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("image/png");
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(png);

    for (const [reason, status] of [
      ["disabled", 404],
      ["not_found", 404],
      ["no_coordinates", 404],
      ["render_failed", 502],
    ] as const) {
      const app = createApp({
        eventStaticMapService: {
          getForEvent: async () => ({ ok: false, reason }),
        },
      });
      expect((await app.request("/m/evt_1.png")).status).toBe(status);
    }
  });
});
