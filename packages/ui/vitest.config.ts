import { defineConfig } from "vitest/config";
import { vitestCoverage } from "../../vitest.coverage.ts";

export default defineConfig({
  test: {
    coverage: vitestCoverage,
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["./test/setup.ts"],
  },
});
