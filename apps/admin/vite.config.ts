import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolveAppVersion, resolveCommitSha, writeBuildMetaJson } from "./build-meta.ts";

/** Emit `dist/build-meta.json` so `/api/admin/health` can report the same build as the sidebar. */
function emitBuildMeta(): Plugin {
  return {
    name: "admitto-emit-build-meta",
    writeBundle(outputOptions) {
      const outDir = outputOptions.dir;
      if (outDir) writeBuildMetaJson(outDir);
    },
  };
}

/**
 * @tabler/icons-webfont's stylesheet declares its @font-face with woff2 + woff + truetype
 * fallbacks. This app ships as a native ES module with no legacy bundle (see AGENTS.md "Font
 * formats") - every browser that can run it already supports woff2, and a browser's own
 * within-@font-face format() fallback already skips woff/truetype in favor of woff2, so those
 * files are never actually fetched at runtime. But Vite's CSS asset pipeline still discovers and
 * copies every url() it finds, runtime-unreachable or not, so they were shipping ~3.3MB of dead
 * weight into dist regardless. Stripping the two fallback url()s here - before Vite's CSS
 * pipeline resolves them into assets - keeps them out of the build entirely.
 */
function stripLegacyIconFontFallback(): Plugin {
  const FALLBACK_SRC = /,url\([^)]*\.woff\?[^)]*\)\s*format\("woff"\),url\([^)]*\.ttf\?[^)]*\)\s*format\("truetype"\)/;
  return {
    name: "admitto-strip-legacy-icon-font-fallback",
    // Must run before Vite's own `vite:css` plugin resolves `url()` references into emitted
    // assets, or the woff/truetype files are already discovered and copied by the time this
    // transform sees the CSS.
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("@tabler/icons-webfont") || !id.endsWith(".css")) return null;
      if (!FALLBACK_SRC.test(code)) return null;
      return code.replace(FALLBACK_SRC, "");
    },
  };
}

export default defineConfig({
  plugins: [react(), emitBuildMeta(), stripLegacyIconFontFallback()],
  base: "/",
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
    __APP_COMMIT__: JSON.stringify(resolveCommitSha()),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Small font subset files (@fontsource ships many per-language ones, some under 4KB) would
    // otherwise get base64-inlined as data: URIs - blocked outright by the staff SPA's own CSP
    // (font-src 'self' https:, no data:), so some weights/styles silently failed to load.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/login": "http://localhost:3000",
      "/logout": "http://localhost:3000",
      "/mfa": "http://localhost:3000",
      "/healthz": "http://localhost:3000",
    },
  },
});
