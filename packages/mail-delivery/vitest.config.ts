import { defineConfig } from "vitest/config";
import { vitestCoverage } from "../../vitest.coverage.ts";

export default defineConfig({
  test: {
    coverage: vitestCoverage,
    include: ["test/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    env: {
      DATABASE_URL: "postgresql://admitto:admitto@localhost:5432/admitto_mail_delivery_test",
      ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      NODE_ENV: "test",
      BASE_URL: "https://tickets.example.com",
    },
  },
});
