import { WEB_TEST_DATABASE_URL } from "./test/testEnv.ts";

/**
 * Env vars shared by unit and integration Vitest projects.
 * Fixed test-only secrets (not production); mirrors `.github/workflows/ci.yml` test env.
 *
 * REDIS_URL is NOT listed here — it is injected at runtime by integrationGlobalSetup.ts
 * which starts a Testcontainers Redis container when REDIS_URL is not already set.
 * Fork-pool workers inherit the updated process.env after globalSetup runs, so
 * redis.test.ts always executes.  No manual Docker setup required.
 */
export const sharedTestEnv: Record<string, string> = {
  DATABASE_URL: WEB_TEST_DATABASE_URL,
  ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  NODE_ENV: "test",
  BASE_URL: "https://tickets.example.com",
  CHECKIN_OPERATOR_TOKEN: "test-checkin-token-for-vitest-32chars!",
  // Pinned to the shipped defaults so a variable exported in a developer shell or CI job cannot
  // change the limits the rate-limit tests assert against (checkin-stream-config.ts).
  CHECKIN_STREAM_RATE_LIMIT_PER_EVENT: "120",
  CHECKIN_STREAM_RATE_LIMIT_PER_ACTOR: "240",
  CHECKIN_STREAM_RATE_LIMIT_WINDOW_MS: "60000",
  CHECKIN_STREAM_MAX_CONCURRENT_PER_EVENT: "3",
  CHECKIN_STREAM_MAX_CONCURRENT_PER_ACTOR: "12",
};
