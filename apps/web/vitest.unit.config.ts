import { defineConfig } from "vitest/config";
import { sharedTestEnv } from "./vitest.shared.ts";

export default defineConfig({
  test: {
    name: "unit",
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**/*.test.ts"],
    environment: "node",
    env: sharedTestEnv,
  },
});
