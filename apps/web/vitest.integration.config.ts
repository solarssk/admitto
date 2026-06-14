import { defineConfig } from "vitest/config";
import { sharedTestEnv } from "./vitest.shared.ts";

export default defineConfig({
  test: {
    name: "integration",
    include: ["test/integration/**/*.test.ts"],
    globalSetup: ["test/integrationGlobalSetup.ts"],
    environment: "node",
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    env: sharedTestEnv,
  },
});
