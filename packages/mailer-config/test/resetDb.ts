import { execSync } from "node:child_process";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";

/**
 * Resets the test database by pushing the current Prisma schema.
 * Each test file calls this from its own beforeAll() — sequential execution
 * is guaranteed by fileParallelism: false in vitest.config.ts, so there is
 * no race between files sharing the same DATABASE_URL.
 */
export function resetDb(): void {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: new URL("../../db", import.meta.url).pathname,
    env: process.env,
    stdio: "pipe",
  });
}
