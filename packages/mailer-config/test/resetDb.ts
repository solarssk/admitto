import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";

// Absolute path to the workspace-hoisted prisma binary, invoked directly instead of a bare "npx
// prisma" — npx resolves commands via the inherited PATH, which SonarCloud (typescript:S4036)
// flags since a writable directory earlier in PATH could shadow the real binary. Resolving to the
// exact installed file removes the PATH lookup for the command itself.
const PRISMA_BIN = fileURLToPath(new URL("../../../node_modules/.bin/prisma", import.meta.url));

/**
 * Resets the test database by pushing the current Prisma schema.
 * Each test file calls this from its own beforeAll() — sequential execution
 * is guaranteed by fileParallelism: false in vitest.config.ts, so there is
 * no race between files sharing the same DATABASE_URL.
 */
export function resetDb(): void {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync(`node ${JSON.stringify(PRISMA_BIN)} db push --force-reset --accept-data-loss`, {
    cwd: new URL("../../db", import.meta.url).pathname,
    env: process.env,
    stdio: "pipe",
  });
}
