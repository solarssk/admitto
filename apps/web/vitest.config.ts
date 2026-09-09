import { defineConfig } from "vitest/config";
import { vitestCoverage } from "../../vitest.coverage.ts";

export default defineConfig({
  test: {
    coverage: vitestCoverage,
    maxWorkers: 1,
    fileParallelism: false,
    projects: [
      "./vitest.unit.config.ts",
      "./vitest.integration.config.ts",
      "./vitest.integration-parallel.config.ts",
    ],
    // No sequence.concurrent here - it only affects tests *within* one file (and defaults to
    // off), so it never serialized these projects. "web-unit" and "integration" (this file's
    // first two entries) already run one file at a time: both leaf configs set
    // fileParallelism: false (normalized to maxWorkers: 1, which routes their files into
    // Vitest's shared sequential group), and each project's globalSetup runs before any test
    // file starts. "integration-parallel" deliberately does NOT set fileParallelism: false - its
    // files hold no shared mutable state (unlike the SystemSettings-touching files in
    // "integration"), so Vitest schedules them in the normal parallel worker pool instead of
    // that shared sequential group; per the repo-root vitest.config.ts's own comment, the
    // sequential group only starts after the parallel pool has fully drained, so this project's
    // files never overlap in wall-clock with "web-unit" or "integration".
  },
});
