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
    // Previously serialized (fileParallelism: false, maxWorkers: 1) to "avoid Prisma client
    // races when unit files import @admitto/auth in parallel" - that race was actually just
    // unit-test files paying the cost of constructing a real (unused) PrismaClient singleton at
    // import time, from 4 packages/auth/src files that runtime-imported hasScope/
    // isSerializationFailure/Prisma from the bare "@admitto/db" barrel instead of its
    // side-effect-free "/client"/"/roles"/"/errors" subpaths (fixed alongside this change - see
    // that commit). Every real DB-touching test in this project already vi.mock()s @admitto/auth
    // and injects a hand-built fake PrismaClient, so no test here ever issues a real query.
    // maxWorkers: 4 matches GitHub Actions' ubuntu-latest runner core count. Verified empirically
    // after the import fix: 27 repeated local runs across maxWorkers 1/2/4/8, zero flakiness,
    // wall-clock ~58s (1) -> ~32s (2) -> ~17s (4) -> ~11s (8).
    pool: "forks",
    maxWorkers: 4,
    env: sharedTestEnv,
    // A known Vitest teardown race can surface at this concurrency - see the root
    // apps/web/vitest.config.ts's `onUnhandledError` for the suppression (onUnhandledError is a
    // root-only option; Vitest ignores it if set on a project config like this one).
  },
});
