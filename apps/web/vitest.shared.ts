import { WEB_TEST_DATABASE_URL } from "./test/testEnv.ts";

/**
 * Env vars shared by unit and integration Vitest projects.
 * Fixed test-only secrets (not production); mirrors `.github/workflows/ci.yml` test env.
 *
 * REDIS_URL is forwarded from the process environment when present so that
 * redis.test.ts runs locally (docker run -d -p 6379:6379 redis:7-alpine) and
 * in CI where the service is always available.  When absent the two Redis
 * integration tests are skipped via describe.skipIf — all other tests still pass.
 */
export const sharedTestEnv: Record<string, string> = {
  DATABASE_URL: WEB_TEST_DATABASE_URL,
  ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  NODE_ENV: "test",
  BASE_URL: "https://tickets.example.com",
  CHECKIN_OPERATOR_TOKEN: "test-checkin-token-for-vitest-32chars!",
  ...(process.env.REDIS_URL ? { REDIS_URL: process.env.REDIS_URL } : {}),
};
