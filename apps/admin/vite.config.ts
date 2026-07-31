import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootVersion = (
  JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8")) as { version: string }
).version;

// The production image has no .git dir, so publish-container.yml passes the real commit as a
// Docker build-arg (GIT_COMMIT); local dev/builds fall back to the checked-out HEAD.
function resolveCommitSha(): string {
  const sha = process.env.GIT_COMMIT ?? gitHeadSha();
  return sha ? sha.slice(0, 7) : "unknown";
}

function gitHeadSha(): string | null {
  try {
    // --short is skipped: its length varies with hash density (7 or 8+ chars depending on the
    // repo) - always resolve the full SHA and slice to a fixed 7, matching GitHub's own display.
    return execSync("git rev-parse HEAD", { cwd: __dirname }).toString().trim();
  } catch {
    return null;
  }
}

export default defineConfig({
  plugins: [react()],
  base: "/",
  define: {
    __APP_VERSION__: JSON.stringify(rootVersion),
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
