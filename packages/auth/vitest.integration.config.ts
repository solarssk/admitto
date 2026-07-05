import { defineConfig } from "vitest/config";
import { vitestCoverageMerge } from "../../vitest.coverage.ts";

const AUTH_TEST_DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://admitto:admitto@localhost:5432/admitto_auth_test";

export default defineConfig({
  test: {
    coverage: vitestCoverageMerge,
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
