import { defineConfig } from "vitest/config";
import { WEB_TEST_DATABASE_URL } from "./test/testEnv.ts";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/globalSetup.ts"],
    environment: "node",
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    env: {
      DATABASE_URL: WEB_TEST_DATABASE_URL,
      ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      NODE_ENV: "test",
      BASE_URL: "https://tickets.example.com",
      CHECKIN_OPERATOR_TOKEN: "test-checkin-token-for-vitest-32chars!",
    },
  },
});
