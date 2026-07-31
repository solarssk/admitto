import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolveAppVersion, resolveCommitSha } from "./build-meta.ts";

export default defineConfig({
  plugins: [react()],
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
