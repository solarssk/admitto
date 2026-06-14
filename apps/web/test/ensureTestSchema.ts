import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WEB_TEST_DATABASE_URL } from "./testEnv.js";

const execAsync = promisify(exec);
const DB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packages", "db");
const MIGRATE_TIMEOUT_MS = 60_000;

let schemaReady: Promise<void> | undefined;

function testDbEnv(): NodeJS.ProcessEnv {
  return { ...process.env, DATABASE_URL: WEB_TEST_DATABASE_URL };
}

function migrateErrorText(error: unknown): string {
  if (error && typeof error === "object") {
    const err = error as { message?: string; stderr?: string };
    return `${err.message ?? ""}\n${err.stderr ?? ""}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** P3005: tables exist without `_prisma_migrations` (e.g. legacy `db push --force-reset`). */
function isMissingMigrationHistoryError(error: unknown): boolean {
  return migrateErrorText(error).includes("P3005");
}

async function runPrisma(command: string, env: NodeJS.ProcessEnv): Promise<void> {
  await execAsync(command, { cwd: DB_ROOT, env, timeout: MIGRATE_TIMEOUT_MS });
}

async function ensureTestSchema(): Promise<void> {
  const env = testDbEnv();
  try {
    await runPrisma("npx prisma migrate deploy", env);
  } catch (migrateError) {
    if (process.env["CI"] && !isMissingMigrationHistoryError(migrateError)) {
      throw migrateError;
    }
    console.warn(
      "[ensureTestSchema] migrate deploy failed, falling back to db push:",
      migrateError,
    );
    await runPrisma("npx prisma db push --skip-generate", env);
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
