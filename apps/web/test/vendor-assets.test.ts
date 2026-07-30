import { createRequire } from "node:module";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Context } from "hono";
import {
  builtInFontFaceCss,
  serveFontsourceFonts,
  serveTablerIcons,
  serveVendorFileForTests,
  tryResolveForTests,
} from "../src/vendor-assets.js";

const require = createRequire(import.meta.url);
const MANROPE_FILES_DIR = dirname(require.resolve("@fontsource/manrope/package.json")) + "/files";

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

  it.each([
    ["a package outside the built-in allowlist", "/vendor/fontsource/comic-sans/comic-sans-latin-400-normal.woff2"],
    ["no file segment given", "/vendor/fontsource/manrope"],
    ["an unknown file within a known package", "/vendor/fontsource/manrope/does-not-exist.woff2"],
    ["a file that resolves to no physical file on disk (valid extension, wrong name)", "/vendor/fontsource/manrope/manrope-latin-400-normal.css"],
    ["a genuinely disallowed extension (not in the MIME map at all)", "/vendor/fontsource/manrope/manrope-latin-400-normal.png"],
  ])("404s for %s", async (_case, path) => {
    const res = await appWithFontsourceRoute().request(path);
    expect(res.status).toBe(404);
  });

  it("rejects path traversal outside the package's files directory", async () => {
    // Real HTTP requests never reach the code with a raw ".." still in the path - both Hono's own
    // request-testing helper and @hono/node-server's real request handling already collapse
    // dot-segments before any handler sees them (confirmed empirically, incl. against the real
    // running dev server). This documents that normalization; the guard itself is tested directly
    // via serveVendorFileForTests below, where a raw ".." can actually reach it.
    const res = await appWithFontsourceRoute().request("/vendor/fontsource/manrope/../../../../../../etc/passwd");
    expect([403, 404]).toContain(res.status);
    const text = await res.text();
    expect(text).not.toContain("root:");
  });
});

describe("serveTablerIcons", () => {
  it("serves the self-hosted Tabler Icons stylesheet", async () => {
    const app = new Hono();
    app.get("/vendor/tabler-icons/*", serveTablerIcons);
    const res = await app.request("/vendor/tabler-icons/tabler-icons.min.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
  });
});

/** Duck-typed Context exposing only `req.path` and `notFound()` - the two members
 * serveTablerIcons/serveFontsourceFonts touch before ever reaching serveVendorFile. Hono's router
 * never actually calls either handler with a mismatched path (that's the whole point of
 * registering them at a fixed prefix), so their own defensive prefix check is only reachable by
 * calling the exported handler directly like this. */
function fakeContextWithPath(path: string) {
  return {
    req: { path },
    notFound: () => new Response("404 Not Found", { status: 404 }),
  } as unknown as Context;
}

describe("prefix mismatch (defensive; unreachable through normal Hono routing)", () => {
  it("serveTablerIcons 404s for a path outside its own prefix", async () => {
    const res = await serveTablerIcons(fakeContextWithPath("/not-tabler-icons/x"), (() => Promise.resolve()) as never);
    expect((res as Response).status).toBe(404);
  });

  it("serveFontsourceFonts 404s for a path outside its own prefix", async () => {
    const res = await serveFontsourceFonts(fakeContextWithPath("/not-fontsource/x"), (() => Promise.resolve()) as never);
    expect((res as Response).status).toBe(404);
  });
});

/** Minimal duck-typed Context - serveVendorFile only ever calls these four methods. */
function fakeContext() {
  const headers: Record<string, string> = {};
  return {
    header: (key: string, value: string) => {
      headers[key] = value;
    },
    text: (body: string, status: number) => new Response(body, { status }),
    notFound: () => new Response("404 Not Found", { status: 404 }),
    body: (data: Uint8Array) => new Response(data, { status: 200, headers }),
  } as unknown as Context;
}

describe("serveVendorFileForTests", () => {
  it("serves a real file under baseDir", async () => {
    const res = await serveVendorFileForTests(fakeContext(), MANROPE_FILES_DIR, "manrope-latin-400-normal.woff2");
    expect(res.status).toBe(200);
  });

  it("returns 403 Forbidden for a relative path that escapes baseDir", async () => {
    // Called directly with a raw ".." so no URL-layer normalization can intercept it first -
    // this is the guard serveFontsourceFonts/serveTablerIcons can never actually reach it through
    // (see the note in serveFontsourceFonts's own traversal test above).
    const res = await serveVendorFileForTests(fakeContext(), MANROPE_FILES_DIR, "../../../../../etc/passwd");
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("returns 404 for an extension not in the MIME map", async () => {
    const res = await serveVendorFileForTests(fakeContext(), MANROPE_FILES_DIR, "manrope-latin-400-normal.png");
    expect(res.status).toBe(404);
  });

  it("returns 404 when the file doesn't exist on disk", async () => {
    const res = await serveVendorFileForTests(fakeContext(), MANROPE_FILES_DIR, "does-not-exist.woff2");
    expect(res.status).toBe(404);
  });
});

describe("tryResolveForTests", () => {
  it("resolves a real installed package", () => {
    expect(tryResolveForTests("@fontsource/manrope/package.json")).toMatch(/package\.json$/);
  });

  it("returns an empty string for a package that can't be resolved", () => {
    expect(tryResolveForTests("@definitely-not-a-real-package-xyz-123/whatever")).toBe("");
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
