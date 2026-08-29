import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const webDir = path.join(repoRoot, "apps", "web");

// Reuses the same PORT variable @admitto/web's own server already reads (apps/web/src/index.ts),
// not an E2E-specific name — see deploy/env-catalog.json / docs:env's env-var scan.
const PORT = process.env["PORT"] ?? "3100";
const BASE_URL = `http://localhost:${PORT}`;

// Required — this points the seed script and the app server at the SAME database. Point it at
// a disposable database (never the shared local dev "admitto" DB): see apps/admin/README.md's
// "E2E (Playwright)" section.
const DATABASE_URL = process.env["DATABASE_URL"];
const ENCRYPTION_KEY = process.env["ENCRYPTION_KEY"];
if (!DATABASE_URL || !ENCRYPTION_KEY) {
  throw new Error(
    "playwright.config.ts: DATABASE_URL and ENCRYPTION_KEY must be set in the environment " +
      "before running the check-in E2E smoke test — see apps/admin/README.md's " +
      '"E2E (Playwright)" section.',
  );
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["github"]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Prod-like "single server" mode (README's "Single server (prod-like)" row): admin must
  // already be built (`npm run build -w @admitto/admin`) so apps/web has static assets to
  // serve — this config does not build it for you, see apps/admin/README.md.
  webServer: {
    command: "node --import tsx --env-file-if-exists=.env src/index.ts",
    cwd: webDir,
    url: BASE_URL,
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
    env: {
      NODE_ENV: "development",
      PORT,
      BASE_URL,
      DATABASE_URL,
      ENCRYPTION_KEY,
      ...(process.env["REDIS_URL"] ? { REDIS_URL: process.env["REDIS_URL"] } : {}),
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
