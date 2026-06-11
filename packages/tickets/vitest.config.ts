import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Sequential: tests share a single Postgres test database; concurrent db push --force-reset would race.
    fileParallelism: false,
    env: {
      DATABASE_URL: "postgresql://admitto:admitto@localhost:5432/admitto_tickets_test",
    },
  },
});
