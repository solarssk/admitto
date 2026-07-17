import { exec, execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..", "..", "db");
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function migrateErrorText(error: unknown): string {
  if (error && typeof error === "object") {
    const err = error as { message?: string; stderr?: string };
    return `${err.message ?? ""}\n${err.stderr ?? ""}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function isMissingMigrationHistoryError(error: unknown): boolean {
  return migrateErrorText(error).includes("P3005");
}

/** Extract the database name from a PostgreSQL connection URL. */
function databaseName(databaseUrl: string): string {
  return new URL(databaseUrl).pathname.replace(/^\//, "");
}

/** Derive PG* env vars from DATABASE_URL so reset-test-db.sh targets the same server, not its own defaults. */
function pgConnectionEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
}

export default async function integrationGlobalSetup(): Promise<void> {
  const env = {
    ...process.env,
    DATABASE_URL:
      process.env["DATABASE_URL"] ?? "postgresql://admitto:admitto@localhost:5432/admitto_auth_test",
  };
  assertTestDatabaseUrl(env.DATABASE_URL!);
  try {
    await execAsync("npx prisma migrate deploy", { cwd: DB_ROOT, env, timeout: 60_000 });
  } catch (migrateError) {
    if (!isMissingMigrationHistoryError(migrateError)) {
      throw migrateError;
    }
    // P3005: schema exists without _prisma_migrations (unit tests run `db push --force-reset`).
    // `db push` cannot recreate the partial UNIQUE indexes that live only in migration SQL
    // (RoleAssignment, OidcRoleGrant, ...), so drop/recreate the DB and replay all migrations.
    // Uses reset-test-db.sh (not `prisma migrate reset`) because it independently re-checks
    // the database name ends with `_test` before dropping anything — `migrate reset` trusts
    // ambient DATABASE_URL and would wipe any localhost DB, test-named or not.
    console.warn("[auth integrationGlobalSetup] migrate deploy P3005, falling back to DB reset");
    await execFileAsync("bash", ["infra/scripts/reset-test-db.sh", databaseName(env.DATABASE_URL!)], {
      cwd: REPO_ROOT,
      env: { ...env, ...pgConnectionEnv(env.DATABASE_URL!) },
      timeout: 60_000,
    });
    await execAsync("npx prisma migrate deploy", { cwd: DB_ROOT, env, timeout: 60_000 });
  }
}
