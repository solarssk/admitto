import { defineConfig } from "vitest/config";
import { vitestCoverage } from "../../vitest.coverage.ts";

// Fixed, not `process.env["DATABASE_URL"] ?? ...` - an ambient DATABASE_URL (e.g. CI's
// job-level default, or a developer's shell) must never redirect this destructive
// migrate/reset flow, matching every sibling package's vitest config (db/tickets/import/web).
const AUTH_TEST_DATABASE_URL = "postgresql://admitto:admitto@localhost:5432/admitto_auth_test";

export default defineConfig({
  test: {
    coverage: {
      ...vitestCoverage,
      reportsDirectory: "./coverage-integration",
    },
    name: "auth-integration",
    include: ["test/integration/**/*.test.ts"],
    globalSetup: ["test/integrationGlobalSetup.ts"],
    environment: "node",
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    env: {
      DATABASE_URL: AUTH_TEST_DATABASE_URL,
      NODE_ENV: "test",
      ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    },
  },
});
