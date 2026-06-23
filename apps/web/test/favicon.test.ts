import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { ADMITTO_FAVICON_SVG, renderAdmittoFaviconLink } from "../src/favicon.js";

describe("favicon", () => {
  it("declares SVG, PNG, and apple-touch-icon links", () => {
    const link = renderAdmittoFaviconLink();
    expect(link).toContain('/favicon.svg');
    expect(link).toContain('/favicon-32.png');
    expect(link).toContain('/apple-touch-icon.png');
    expect(link).toContain('rel="apple-touch-icon"');
  });

  it("serves icon routes", async () => {
    const app = createApp();
    const cases: Array<[string, string]> = [
      ["/favicon.svg", "image/svg+xml"],
      ["/favicon-32.png", "image/png"],
      ["/favicon.ico", "image/png"],
      ["/apple-touch-icon.png", "image/png"],
      ["/apple-touch-icon-precomposed.png", "image/png"],
    ];
    for (const [path, typePrefix] of cases) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toContain(typePrefix);
    }
    expect(await (await app.request("/favicon.svg")).text()).toBe(ADMITTO_FAVICON_SVG);
    const png = await (await app.request("/apple-touch-icon.png")).arrayBuffer();
    expect(png.byteLength).toBeGreaterThan(500);
  });
});
