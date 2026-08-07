import { exec, execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const DB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db");
const REPO_ROOT = path.resolve(DB_ROOT, "../..");

function databaseName(databaseUrl: string): string {
  return new URL(databaseUrl).pathname.replace(/^\//, "");
}

function pgConnectionEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
}

/**
 * Drop/recreate the package `*_test` DB and apply full migration history
 * (including raw SQL partial indexes not expressible in schema.prisma).
 * Uses reset-test-db.sh (not `prisma migrate reset`) so the name must end in `_test`.
 */
export async function resetDb(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  assertTestDatabaseUrl(databaseUrl);
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  await execFileAsync("bash", ["infra/scripts/reset-test-db.sh", databaseName(databaseUrl)], {
    cwd: REPO_ROOT,
    env: { ...env, ...pgConnectionEnv(databaseUrl) },
    timeout: 60_000,
  });
  await execAsync("npx prisma migrate deploy", { cwd: DB_ROOT, env, timeout: 60_000 });
}
