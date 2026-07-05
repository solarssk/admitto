import { defineConfig } from "vitest/config";
import { vitestCoverage } from "../../vitest.coverage.ts";

export default defineConfig({
  test: {
    coverage: vitestCoverage,
    projects: ["./vitest.unit.config.ts", "./vitest.integration.config.ts"],
    // Avoid Prisma client/package.json races when unit imports @admitto/auth
    // while integration globalSetup runs migrate deploy.
    sequence: { concurrent: false },
  },
});
