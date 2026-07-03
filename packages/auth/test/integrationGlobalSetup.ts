import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assertTestDatabaseUrl } from "./assertTestDatabaseUrl.js";

const execAsync = promisify(exec);
const DB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "db");

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
    // (RoleAssignment, OidcRoleGrant, ...), so reset the schema and replay all migrations.
    console.warn("[auth integrationGlobalSetup] migrate deploy P3005, falling back to migrate reset");
    await execAsync("npx prisma migrate reset --force --skip-generate --skip-seed", {
      cwd: DB_ROOT,
      env,
      timeout: 120_000,
    });
  }
}
