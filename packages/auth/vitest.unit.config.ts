import { defineConfig } from "vitest/config";
import { vitestCoverage } from "../../vitest.coverage.ts";

export default defineConfig({
  test: {
    coverage: vitestCoverage,
    // "auth-unit", not "unit" - the repo-root vitest.config.ts aggregator lists this file
    // alongside apps/web/vitest.unit.config.ts (also named "unit" standalone), and Vitest
    // requires every aggregated project name to be unique. Harmless for this package's own
    // standalone `npm run test -w @admitto/auth` - nothing depends on the literal name "unit".
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
