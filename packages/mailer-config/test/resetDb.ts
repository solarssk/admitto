import { execSync } from "node:child_process";

/**
 * Resets the test database by pushing the current Prisma schema.
 * Each test file calls this from its own beforeAll() — sequential execution
 * is guaranteed by fileParallelism: false in vitest.config.ts, so there is
 * no race between files sharing the same DATABASE_URL.
 */
export function resetDb(): void {
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: new URL("../../db", import.meta.url).pathname,
    env: process.env,
    stdio: "pipe",
  });
}
