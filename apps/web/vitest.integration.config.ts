import { defineConfig } from "vitest/config";
import { sharedTestEnv } from "./vitest.shared.ts";
import { INTEGRATION_TEST_WORKER_COUNT } from "./test/provisionWorkerSchemas.ts";

export default defineConfig({
  test: {
    name: "integration",
    include: ["test/integration/**/*.test.ts"],
    // apps/web's own tsconfig compiles test/ too (its `build` script isn't test-scoped), so a
    // stale `dist/` from a prior build can leave compiled .test.js copies sitting next to the
    // source .test.ts files. Vitest's own default excludes dist/, but that stopped applying once
    // this config started being resolved from a root-level vitest.config.ts aggregator instead of
    // its own package directory (2026-07-18 root-run incident) - excluding it explicitly here
    // doesn't depend on which context resolves this file.
    exclude: ["dist/**", "**/node_modules/**"],
    globalSetup: ["test/integrationGlobalSetup.ts"],
    setupFiles: ["test/integrationEnv.ts"],
    environment: "node",
    // Previously fileParallelism:false / maxWorkers:1 - every file shared one Postgres schema
    // (public), so two files running at once could interleave writes/reads against the same
    // rows/global tables. Each Vitest worker now gets its own isolated Postgres schema
    // (test/provisionWorkerSchemas.ts, wired via test/integrationEnv.ts and
    // @admitto/db/testing's createTestPrismaClient) instead, so real parallelism no longer risks
    // cross-file interference - including previously-serial-only files like
    // admin-system-settings.test.ts and security-audit-routes.test.ts, whose SystemSettings/
    // SecurityAuditLog rows now live in that worker's own copy of the schema, not a shared one.
    // maxWorkers MUST match INTEGRATION_TEST_WORKER_COUNT exactly - see that constant's own
    // comment for why a mismatch fails loudly instead of silently losing isolation.
    pool: "forks",
    maxWorkers: INTEGRATION_TEST_WORKER_COUNT,
    env: sharedTestEnv,
  },
});
