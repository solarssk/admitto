import { execFile, spawn } from "node:child_process";
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

function pgArgsFromUrl(
  databaseUrl: string,
): { host: string; port: string; user: string; database: string; password: string } {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    database: url.pathname.replace(/^\//, ""),
    password: decodeURIComponent(url.password || ""),
  };
}

const COMPOSE_FILE = process.env.COMPOSE_FILE ?? "infra/docker-compose.yml";
const DB_SERVICE = process.env.DB_SERVICE ?? "db";

const hostBinaryCache = new Map<string, Promise<boolean>>();

function hasHostBinary(command: string): Promise<boolean> {
  let cached = hostBinaryCache.get(command);
  if (!cached) {
    cached = execFileAsync(command, ["--version"])
      .then(() => true)
      .catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return false;
        throw err;
      });
    hostBinaryCache.set(command, cached);
  }
  return cached;
}

/** Once a host binary is confirmed incompatible with the target server (see runPg below), every
 * later call to that same command skips straight to the Docker fallback instead of re-attempting
 * and re-failing against the host binary each time. */
const forcedDockerCommands = new Set<string>();

type PgCommand = "pg_dump" | "psql";

/**
 * Resolves `pg_dump`/`psql` to either the host binary directly, or the same command run inside
 * the already-running `db` compose service - mirrors infra/scripts/create-test-dbs.sh's own
 * run_psql/run_createdb fallback exactly, including that its Docker branch drops -h/-p/PGPASSWORD:
 * running inside the same container as the server, both commands connect over the local socket,
 * which the official postgres image trusts unconditionally regardless of POSTGRES_PASSWORD.
 * README.md's documented Docker-only setup (Postgres in Docker, no host Postgres client required)
 * relies on that create-test-dbs.sh fallback already - calling either binary directly here (as
 * this file previously did) instead aborted every integration run with `spawn pg_dump ENOENT` on
 * exactly that supported workstation.
 */
async function pgClient(
  command: PgCommand,
  args: string[],
): Promise<{ file: string; args: string[]; env: NodeJS.ProcessEnv }> {
  const { host, port, user, password } = pgArgsFromUrl(WEB_TEST_DATABASE_URL);
  if (!forcedDockerCommands.has(command) && (await hasHostBinary(command))) {
    return {
      file: command,
      args: ["-h", host, "-p", port, "-U", user, ...args],
      env: { ...process.env, PGPASSWORD: password },
    };
  }
  return {
    file: "docker",
    args: ["compose", "-f", COMPOSE_FILE, "exec", "-T", DB_SERVICE, command, "-U", user, ...args],
    env: process.env,
  };
}

/** Runs a resolved pgClient() command, optionally piping `input` to its stdin (used instead of a
 * temp file for the schema replay below, so the Docker fallback above never needs the container to
 * see a path on the host filesystem). */
function run(file: string, args: string[], env: NodeJS.ProcessEnv, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${file} ${args.join(" ")} exited with code ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

/** pg_dump refuses to run against a server newer than itself ("aborting because of server version
 * mismatch" - see PostgreSQL's own pg_dump docs) - a real gap the host-binary-exists check above
 * can't catch, since `pg_dump --version` never talks to any server. A developer on the documented
 * Docker-backed Postgres setup with an older host-installed client would otherwise hit this and
 * fail the whole integration run, even though the container's own (version-matched) pg_dump would
 * work fine. Runs the resolved command; on that specific failure against a host binary, retries
 * the same command through Docker instead and remembers that for the rest of this run. */
async function runPg(command: PgCommand, args: string[], input?: string): Promise<string> {
  const resolved = await pgClient(command, args);
  try {
    return await run(resolved.file, resolved.args, resolved.env, input);
  } catch (err) {
    const isHostVersionMismatch =
      resolved.file !== "docker" && err instanceof Error && /server version mismatch/i.test(err.message);
    if (!isHostVersionMismatch) throw err;

    forcedDockerCommands.add(command);
    const dockerResolved = await pgClient(command, args);
    return run(dockerResolved.file, dockerResolved.args, dockerResolved.env, input);
  }
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
  const { database, user } = pgArgsFromUrl(WEB_TEST_DATABASE_URL);

  const dump = await runPg("pg_dump", ["-d", database, "-n", "public", "--schema-only"]);

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

  await Promise.all(
    Array.from({ length: workerCount }, (_, i) => i + 1).map(async (workerId) => {
      const schema = workerSchemaName(workerId);
      assertSafeIdentifier(schema);
      const rewritten = strippedDump.replace(/\bpublic\./g, `${schema}.`);

      await runPg("psql", [
        "-d",
        database,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE; CREATE SCHEMA "${schema}" AUTHORIZATION "${user}";`,
      ]);

      await runPg("psql", ["-d", database, "-v", "ON_ERROR_STOP=1", "-f", "-"], rewritten);
    }),
  );
}
