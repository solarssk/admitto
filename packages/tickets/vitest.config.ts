import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Shared SQLite test DB — sequential to avoid concurrent db push conflicts.
    fileParallelism: false,
    env: {
      DATABASE_URL: "file:./tickets-test.db",
    },
  },
});
