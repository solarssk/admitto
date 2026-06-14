import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WEB_TEST_DATABASE_URL } from "./testEnv.js";

const execAsync = promisify(exec);
const DB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packages", "db");

function testDbEnv(): NodeJS.ProcessEnv {
  return { ...process.env, DATABASE_URL: WEB_TEST_DATABASE_URL };
}

/**
 * Ensure `admitto_web_test` has the current schema before any web integration test runs.
 * CI creates the database but migrates only the default `admitto` DB in the workflow.
 */
export async function ensureTestSchema(): Promise<void> {
  const env = testDbEnv();
  try {
    await execAsync("npx prisma migrate deploy", { cwd: DB_ROOT, env });
  } catch (migrateError) {
    if (process.env["CI"]) {
      throw migrateError;
    }
    // Local DBs may have been created via `db push --force-reset` without migration history.
    console.warn(
      "[ensureTestSchema] migrate deploy failed, falling back to db push:",
      migrateError,
    );
    await execAsync("npx prisma db push --skip-generate", { cwd: DB_ROOT, env });
  }
}
