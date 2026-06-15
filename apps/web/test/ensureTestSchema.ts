import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WEB_TEST_DATABASE_URL } from "./testEnv.js";

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
const DB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packages", "db");
const MIGRATE_TIMEOUT_MS = 60_000;

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
    if (process.env["CI"] && !isMissingMigrationHistoryError(migrateError)) {
      throw migrateError;
    }
    console.warn(
      "[ensureTestSchema] migrate deploy failed, falling back to db push:",
      migrateError,
    );
    await runPrisma("npx prisma db push --skip-generate --accept-data-loss", env);
  }
}
