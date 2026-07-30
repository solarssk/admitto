import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// Isolated from vendor-assets.test.ts on purpose: this mocks node:module's createRequire so every
// require.resolve() inside vendor-assets.ts fails, exercising the "a self-hosted package genuinely
// isn't installed" fallback (tryResolve returning "", cascading into TABLER_DIST/
// FONTSOURCE_FILES_DIR/BUILT_IN_FONT_FACE_CSS all computed empty at module load) without needing
// to touch the real, always-installed packages the other test file relies on.
vi.mock("node:module", () => ({
  createRequire: () => {
    const fail = (id: string) => {
      throw new Error(`Cannot find module '${id}'`);
    };
    return Object.assign(fail, { resolve: fail });
  },
}));

describe("vendor-assets.ts when its self-hosted packages can't be resolved at all", () => {
  it("degrades gracefully instead of throwing, at both import time and request time", async () => {
    vi.resetModules();
    const mod = await import("../src/vendor-assets.js");

    expect(mod.tryResolveForTests("@fontsource/manrope/package.json")).toBe("");
    expect(mod.builtInFontFaceCss("Inter")).toBeUndefined();

    const tablerApp = new Hono();
    tablerApp.get("/vendor/tabler-icons/*", mod.serveTablerIcons);
    const tablerRes = await tablerApp.request("/vendor/tabler-icons/tabler-icons.min.css");
    expect(tablerRes.status).toBe(404);

    const fontsourceApp = new Hono();
    fontsourceApp.get("/vendor/fontsource/*", mod.serveFontsourceFonts);
    const fontsourceRes = await fontsourceApp.request("/vendor/fontsource/manrope/manrope-latin-400-normal.woff2");
    expect(fontsourceRes.status).toBe(404);
  });
});
