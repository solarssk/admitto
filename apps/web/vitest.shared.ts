import { WEB_TEST_DATABASE_URL } from "./test/testEnv.ts";

/** Env vars shared by unit and integration Vitest projects. */
export const sharedTestEnv: Record<string, string> = {
  DATABASE_URL: WEB_TEST_DATABASE_URL,
  ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  NODE_ENV: "test",
  BASE_URL: "https://tickets.example.com",
  CHECKIN_OPERATOR_TOKEN: "test-checkin-token-for-vitest-32chars!",
};
