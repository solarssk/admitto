import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";

const execAsync = promisify(exec);

const DB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db");

/**
 * Apply full migration history (including raw SQL partial indexes not expressible in schema.prisma).
 * db push alone would skip EmailDelivery_initial_unique and break atomic initial-send dedup.
 */
export async function resetDb(): Promise<void> {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  await execAsync("npx prisma migrate reset --force --skip-seed", {
    cwd: DB_ROOT,
    env: process.env,
  });
}
