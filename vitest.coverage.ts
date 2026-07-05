import type { CoverageOptions } from "vitest/node";

const sharedExclude = [
  "coverage/**",
  "**/dist/**",
  "**/test/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.config.ts",
  "**/node_modules/**",
];

export const vitestCoverage: CoverageOptions = {
  provider: "v8",
  reporter: ["text", "lcov"],
  reportsDirectory: "./coverage",
  exclude: sharedExclude,
};
