import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WEB_TEST_DATABASE_URL } from "./testEnv.js";

const execAsync = promisify(exec);
const DB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packages", "db");

let schemaReady: Promise<void> | undefined;

function testDbEnv(): NodeJS.ProcessEnv {
  return { ...process.env, DATABASE_URL: WEB_TEST_DATABASE_URL };
}

async function ensureTestSchema(): Promise<void> {
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

/**
 * Apply migrations to `admitto_web_test` once per Vitest process.
 * Call from DB-backed integration suites only — not from vitest globalSetup.
 */
export function ensureTestSchemaOnce(): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureTestSchema();
  }
  return schemaReady;
}
