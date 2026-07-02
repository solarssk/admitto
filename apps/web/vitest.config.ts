import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["./vitest.unit.config.ts", "./vitest.integration.config.ts"],
    // Avoid Prisma client/package.json races when unit imports @admitto/auth
    // while integration globalSetup runs migrate deploy.
    sequence: { concurrent: false },
  },
});
