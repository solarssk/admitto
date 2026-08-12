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
    // resetDb() (./test/resetDb.ts) drops/recreates the DB and replays the full migration
    // history via `prisma migrate deploy` before every test file - each internal step already
    // allows up to 60s, but Vitest's default hookTimeout is only 10s, so a slow-but-healthy
    // replay (migration history keeps growing) trips the outer hook first. Give the hook enough
    // room to cover both sequential 60s sub-steps.
    hookTimeout: 120_000,
    env: {
      DATABASE_URL: "postgresql://admitto:admitto@localhost:5432/admitto_mail_delivery_test",
      ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      NODE_ENV: "test",
      BASE_URL: "https://tickets.example.com",
    },
  },
});
