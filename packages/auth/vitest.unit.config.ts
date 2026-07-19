import { defineConfig } from "vitest/config";
import { vitestCoverage } from "../../vitest.coverage.ts";

export default defineConfig({
  test: {
    coverage: vitestCoverage,
    // "auth-unit", not "unit" - the repo-root vitest.config.ts aggregator lists this file
    // alongside apps/web/vitest.unit.config.ts (also named "unit" standalone), and Vitest
    // requires every aggregated project name to be unique. This package's own `test` and
    // `test:unit` scripts select this project by name (`vitest run --project auth-unit`;
    // the filter is an anchored exact match) - keep package.json in sync when renaming.
    name: "auth-unit",
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**"],
    environment: "node",
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    env: {
      DATABASE_URL: "postgresql://admitto:admitto@localhost:5432/admitto_auth_test",
      NODE_ENV: "test",
      ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    },
  },
});
