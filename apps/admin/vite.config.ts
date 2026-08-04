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

export default defineConfig({
  plugins: [react(), emitBuildMeta()],
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
