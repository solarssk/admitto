import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "unit",
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**"],
    environment: "node",
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    env: {
      DATABASE_URL: "postgresql://admitto:admitto@localhost:5432/admitto_auth_test",
      NODE_ENV: "test",
      ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    },
  },
});
