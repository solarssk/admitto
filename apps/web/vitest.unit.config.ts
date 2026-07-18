import { defineConfig } from "vitest/config";
import { sharedTestEnv } from "./vitest.shared.ts";

export default defineConfig({
  test: {
    name: "unit",
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
