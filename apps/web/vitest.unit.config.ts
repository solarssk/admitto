import { defineConfig } from "vitest/config";
import { sharedTestEnv } from "./vitest.shared.ts";

export default defineConfig({
  test: {
    name: "unit",
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**/*.test.ts"],
    environment: "node",
    // Avoid Prisma client races when unit files import `@admitto/auth` in parallel.
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    env: sharedTestEnv,
  },
});
