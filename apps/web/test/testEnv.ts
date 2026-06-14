/** Shared Vitest Postgres URL for apps/web integration tests. */
export const WEB_TEST_DATABASE_URL =
  process.env["WEB_TEST_DATABASE_URL"] ??
  // Local/docker test DB only — same defaults as CI services and create-test-dbs.sh.
  "postgresql://admitto:admitto@localhost:5432/admitto_web_test";
