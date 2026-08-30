import { defineConfig } from "vitest/config";
import { vitestCoverage } from "../../vitest.coverage.ts";

const TEST_DB_USER = "admitto";
const TEST_DB_PASSWORD = "admitto";

export default defineConfig({
  test: {
    coverage: vitestCoverage,
    include: ["test/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    env: {
      DATABASE_URL: `postgresql://${TEST_DB_USER}:${TEST_DB_PASSWORD}@localhost:5432/admitto_mail_templates_test`,
      BASE_URL: "https://tickets.example.com",
    },
  },
});
