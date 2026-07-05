import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { vitestCoverage } from "../../vitest.coverage.ts";

export default defineConfig({
  plugins: [react()],
  test: {
    coverage: vitestCoverage,
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
