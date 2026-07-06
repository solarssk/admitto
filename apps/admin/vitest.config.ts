import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { vitestCoverage } from "../../vitest.coverage.ts";

const rootVersion = (
  JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8")) as { version: string }
).version;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootVersion),
  },
  test: {
    coverage: vitestCoverage,
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
