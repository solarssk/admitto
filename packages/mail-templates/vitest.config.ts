import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    env: {
      DATABASE_URL: "postgresql://admitto:admitto@localhost:5432/admitto_mail_templates_test",
    },
  },
});
