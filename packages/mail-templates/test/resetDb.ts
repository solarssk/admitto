import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";

/** Synchronous schema reset via execSync — call from a non-async beforeAll. */
export function resetDb(): void {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: fileURLToPath(new URL("../../db", import.meta.url)),
    env: process.env,
    stdio: "pipe",
  });
}
