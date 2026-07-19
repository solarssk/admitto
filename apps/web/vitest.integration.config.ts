import { defineConfig } from "vitest/config";
import { sharedTestEnv } from "./vitest.shared.ts";

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
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    env: sharedTestEnv,
  },
});
