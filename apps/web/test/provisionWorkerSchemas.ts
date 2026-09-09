import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { WEB_TEST_DATABASE_URL } from "./testEnv.js";

const execFileAsync = promisify(execFile);

/** Matches web-unit's own maxWorkers choice (apps/web/vitest.unit.config.ts) - GitHub Actions'
 * ubuntu-latest runner core count. vitest.integration.config.ts's own maxWorkers must match this
 * exactly: Vitest's pool assigns VITEST_POOL_ID in the range 1..maxWorkers, and any worker id this
 * constant hasn't provisioned a schema for would fall back to whatever DATABASE_URL's own default
 * schema is (public) - silently losing isolation instead of failing loudly. */
export const INTEGRATION_TEST_WORKER_COUNT = 4;

/** Schema name for a given 1-based Vitest pool worker id. Exported so integrationEnv.ts and this
 * file always agree on the naming scheme. */
export function workerSchemaName(workerId: number): string {
  return `test_worker_${workerId}`;
}

/** Postgres identifiers are case-sensitive when quoted (every name here is), but reject anything
 * that isn't a plain word so a bad env var can't smuggle SQL into an identifier position. */
function assertSafeIdentifier(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to use "${name}" as a Postgres schema name - not a plain identifier.`);
  }
}

function pgArgsFromUrl(databaseUrl: string): { host: string; port: string; user: string; database: string } {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    database: url.pathname.replace(/^\//, ""),
  };
}

/**
 * Builds each worker's isolated schema by dumping the canonical `public` schema's CURRENT
 * structure (already migrated by ensureIntegrationTestSchema) and replaying it, schema-qualified,
 * into `test_worker_<id>` - not by replaying all ~110 migrations per worker. That sidesteps two
 * real problems replaying migration history per-schema would hit: (1) it would be ~N times slower
 * for no benefit (every worker ends up at the same, already-known-good structure); (2) at least
 * two historical migrations call pgcrypto's `gen_random_bytes()` unqualified for a one-time data
 * backfill, which only resolves via `search_path` - a schema created via `?schema=<name>` (Prisma
 * migrate's own connection-string switch) sets `search_path` to *just* that schema, and `pgcrypto`
 * is a database-wide extension permanently registered in `public` (Postgres does not allow a
 * second copy in another schema) - confirmed empirically, this reliably fails those two
 * migrations. A structure-only copy of *today's* schema never touches that historical code path.
 *
 * Safe to re-run: each worker's schema is fully dropped and recreated every call.
 */
export async function provisionWorkerSchemas(workerCount: number): Promise<void> {
  assertTestDatabaseUrl(WEB_TEST_DATABASE_URL);
  const { host, port, user, database } = pgArgsFromUrl(WEB_TEST_DATABASE_URL);
  const psqlArgs = ["-h", host, "-p", port, "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1"];
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(new URL(WEB_TEST_DATABASE_URL).password || "") };

  const { stdout: dump } = await execFileAsync(
    "pg_dump",
    ["-h", host, "-p", port, "-U", user, "-d", database, "-n", "public", "--schema-only"],
    { env, maxBuffer: 64 * 1024 * 1024 },
  );

  // Drop the dump's own `public` schema bootstrap (this repo's schema always exists already) -
  // everything else is fully `public.`-qualified by pg_dump (confirmed: it sets
  // `search_path = ''` in its own preamble specifically so it can't rely on an ambient default),
  // so a plain word-boundary rewrite of that one prefix retargets the entire dump.
  const strippedDump = dump
    .split("\n")
    .filter(
      (line) =>
        !/^CREATE SCHEMA public;$/.test(line) &&
        !/^ALTER SCHEMA public OWNER TO/.test(line) &&
        !/^COMMENT ON SCHEMA public IS/.test(line) &&
        !/^-- Name: SCHEMA public;/.test(line),
    )
    .join("\n");

  const tmpDir = await mkdtemp(join(tmpdir(), "admitto-worker-schema-"));
  try {
    await Promise.all(
      Array.from({ length: workerCount }, (_, i) => i + 1).map(async (workerId) => {
        const schema = workerSchemaName(workerId);
        assertSafeIdentifier(schema);
        const replayFile = join(tmpDir, `${schema}.sql`);
        const rewritten = strippedDump.replace(/\bpublic\./g, `${schema}.`);
        await writeFile(replayFile, rewritten);

        await execFileAsync(
          "psql",
          [...psqlArgs, "-c", `DROP SCHEMA IF EXISTS "${schema}" CASCADE; CREATE SCHEMA "${schema}" AUTHORIZATION "${user}";`],
          { env },
        );
        await execFileAsync("psql", [...psqlArgs, "-f", replayFile], { env });
      }),
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
