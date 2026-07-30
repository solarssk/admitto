import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { builtInFontFaceCss, serveFontsourceFonts } from "../src/vendor-assets.js";

function appWithFontsourceRoute() {
  const app = new Hono();
  app.get("/vendor/fontsource/*", serveFontsourceFonts);
  return app;
}

describe("serveFontsourceFonts", () => {
  it("serves a known built-in font file with correct content type and immutable caching", async () => {
    const res = await appWithFontsourceRoute().request("/vendor/fontsource/manrope/manrope-latin-400-normal.woff2");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("font/woff2");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
  });

  it("404s for a package outside the built-in allowlist", async () => {
    const res = await appWithFontsourceRoute().request("/vendor/fontsource/comic-sans/comic-sans-latin-400-normal.woff2");
    expect(res.status).toBe(404);
  });

  it("404s when no file segment is given", async () => {
    const res = await appWithFontsourceRoute().request("/vendor/fontsource/manrope");
    expect(res.status).toBe(404);
  });

  it("404s for an unknown file within a known package", async () => {
    const res = await appWithFontsourceRoute().request("/vendor/fontsource/manrope/does-not-exist.woff2");
    expect(res.status).toBe(404);
  });

  it("rejects path traversal outside the package's files directory", async () => {
    const res = await appWithFontsourceRoute().request("/vendor/fontsource/manrope/../../../../../../etc/passwd");
    expect([403, 404]).toContain(res.status);
    const text = await res.text();
    expect(text).not.toContain("root:");
  });

  it("404s for a disallowed extension even inside a known package's files directory", async () => {
    const res = await appWithFontsourceRoute().request("/vendor/fontsource/manrope/manrope-latin-400-normal.css");
    expect(res.status).toBe(404);
  });
});

describe("builtInFontFaceCss", () => {
  it("returns undefined for a name that isn't one of the 4 built-ins", () => {
    expect(builtInFontFaceCss("Comic Sans")).toBeUndefined();
    expect(builtInFontFaceCss("")).toBeUndefined();
  });

  it("returns self-hosted @font-face CSS for Inter, rewritten to the /vendor/fontsource route", () => {
    const css = builtInFontFaceCss("Inter");
    expect(css).toBeDefined();
    expect(css).toContain("@font-face");
    expect(css).toContain("font-family: 'Inter'");
    expect(css).toContain("url(/vendor/fontsource/inter/");
    expect(css).not.toContain("url(./files/");
    // fonts.css imports the full 400/500/600/700 set for Inter - unlike the other 3 built-ins.
    expect(css).toContain("font-weight: 600");
  });

  it.each(["Manrope", "Space Grotesk", "IBM Plex Sans"] as const)(
    "returns self-hosted @font-face CSS for built-in %s",
    (family) => {
      const css = builtInFontFaceCss(family);
      expect(css).toBeDefined();
      expect(css).toContain("@font-face");
      expect(css).toContain(`font-family: '${family}'`);
      expect(css).toContain("url(/vendor/fontsource/");
      expect(css).not.toContain("url(./files/");
    },
  );

  it("pulls the full 400/500/600/700 weight set fonts.css imports for Manrope, matching the app's own font-weight:600 UI text", () => {
    const css = builtInFontFaceCss("Manrope");
    expect(css).toContain("font-weight: 400");
    expect(css).toContain("font-weight: 500");
    expect(css).toContain("font-weight: 600");
    expect(css).toContain("font-weight: 700");
  });

  it("never claims an italic face for Manrope or Space Grotesk (neither ships one, matching fonts.css)", () => {
    for (const family of ["Manrope", "Space Grotesk"] as const) {
      const css = builtInFontFaceCss(family);
      expect(css).not.toContain("font-style: italic");
    }
  });
});
