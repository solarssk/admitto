import { defineConfig } from "vitest/config";
import { vitestCoverage } from "../../vitest.coverage.ts";

export default defineConfig({
  test: {
    coverage: vitestCoverage,
    maxWorkers: 1,
    fileParallelism: false,
    projects: ["./vitest.unit.config.ts", "./vitest.integration.config.ts"],
    // No sequence.concurrent here - it only affects tests *within* one file (and defaults to
    // off), so it never serialized these two projects. They already run one file at a time:
    // both leaf configs set fileParallelism: false (normalized to maxWorkers: 1, which routes
    // their files into Vitest's shared sequential group), and each project's globalSetup runs
    // before any test file starts.
  },
});
