import { defineConfig } from "vitest/config";
import { sharedTestEnv } from "./vitest.shared.ts";

export default defineConfig({
  test: {
    // "web-unit", not "unit" - the repo-root vitest.config.ts aggregator lists this file
    // alongside packages/auth/vitest.unit.config.ts (also named "unit" standalone), and Vitest
    // requires every aggregated project name to be unique. This package's `test:unit` script
    // selects this project by name (`vitest run --project web-unit`; the filter is an anchored
    // exact match) - keep package.json in sync when renaming.
    name: "web-unit",
    include: ["test/**/*.test.ts"],
    // Also excludes dist/ - see the matching comment in vitest.integration.config.ts.
    exclude: ["test/integration/**/*.test.ts", "dist/**", "**/node_modules/**"],
    environment: "node",
    // Avoid Prisma client races when unit files import `@admitto/auth` in parallel.
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    env: sharedTestEnv,
  },
});
