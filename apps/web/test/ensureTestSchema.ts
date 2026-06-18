import { exec, execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WEB_TEST_DATABASE_URL } from "./testEnv.js";

/** Refuse Prisma setup unless DATABASE_URL targets a local or `*_test` database. */
function assertTestDatabaseUrl(databaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Refusing Prisma setup: DATABASE_URL is not a valid URL");
  }

  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
  const isTestHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const isTestDb = dbName.includes("_test") || dbName.endsWith("_test");

  if (isTestHost || isTestDb) return;

  throw new Error(
    `Refusing Prisma setup: DATABASE_URL host "${host}" database "${dbName || "(default)"}" does not look like a test target`,
  );
}

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const DB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packages", "db");
const REPO_ROOT = path.resolve(DB_ROOT, "..", "..");
const MIGRATE_TIMEOUT_MS = 60_000;

/** Process env with `DATABASE_URL` set to the web integration test database. */
function testDbEnv(): NodeJS.ProcessEnv {
  return { ...process.env, DATABASE_URL: WEB_TEST_DATABASE_URL };
}

/** Flatten Prisma CLI exec errors for P3005 detection. */
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

/** Run a Prisma CLI command in the db package with a timeout. */
async function runPrisma(command: string, env: NodeJS.ProcessEnv): Promise<void> {
  await execAsync(command, { cwd: DB_ROOT, env, timeout: MIGRATE_TIMEOUT_MS });
}

/** Extract database name from a PostgreSQL connection URL. */
function testDatabaseName(databaseUrl: string): string {
  return new URL(databaseUrl).pathname.replace(/^\//, "");
}

/** Drop and recreate the test database (P3005 recovery — restores migration history). */
async function resetTestDatabase(env: NodeJS.ProcessEnv): Promise<void> {
  const dbName = testDatabaseName(env.DATABASE_URL!);
  await execFileAsync("bash", ["infra/scripts/reset-test-db.sh", dbName], {
    cwd: REPO_ROOT,
    env,
    timeout: MIGRATE_TIMEOUT_MS,
  });
}

/**
 * Run `prisma migrate deploy` once per integration Vitest run (via globalSetup).
 * See ADR-0015-test-strategy.md — no `db push --force-reset` in test files.
 */
export async function ensureIntegrationTestSchema(): Promise<void> {
  const env = testDbEnv();
  assertTestDatabaseUrl(env.DATABASE_URL!);
  try {
    await runPrisma("npx prisma migrate deploy", env);
  } catch (migrateError) {
    if (isMissingMigrationHistoryError(migrateError)) {
      console.warn(
        "[ensureTestSchema] P3005 — resetting test DB and retrying migrate deploy",
      );
      await resetTestDatabase(env);
      await runPrisma("npx prisma migrate deploy", env);
      return;
    }
    if (process.env["CI"]) {
      throw migrateError;
    }
    console.warn(
      "[ensureTestSchema] migrate deploy failed, falling back to db push:",
      migrateError,
    );
    await runPrisma("npx prisma db push --skip-generate --accept-data-loss", env);
  }
}
