import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Bounds how long a single SQL statement may run once it reaches Postgres (enforced server-side,
 * unlike connectionTimeoutMillis below which only bounds acquiring a connection from the pool).
 * Sized for request/worker-path OLTP queries - every batched write in the codebase (import,
 * export, retention) already chunks at 1,000-5,000 rows specifically to keep each round trip
 * short, so this is generous headroom above that, not a tight fit. Without it, a query stuck
 * behind a lock (e.g. a burst of concurrent writes) can run indefinitely instead of failing fast.
 *
 * Also imported directly (via the `@admitto/db/adapter` subpath) by the worker's two dedicated
 * `pg.Client` connections (apps/cli/src/commands/worker-locks.ts, worker-notify.ts) - those never
 * go through PrismaPg at all, so createPrismaAdapter's own default doesn't reach them.
 */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

/**
 * Builds the Postgres driver adapter Prisma ORM v7 requires for every PrismaClient instance
 * (no more implicit query engine). connectionTimeoutMillis/idleTimeoutMillis restore the
 * pre-v7 defaults (5s / 300s) — @prisma/adapter-pg v7's own defaults are 0 (no connect
 * timeout at all, i.e. a request can hang forever) and 10s idle.
 *
 * Kept in its own module (not exported from ./index.js) so callers that only need to build a
 * standalone client — the dev seed scripts, the future @admitto/db/testing helper — don't also
 * trigger index.ts's module-level singleton construction as a side effect.
 *
 * `statementTimeoutMs` defaults to DEFAULT_STATEMENT_TIMEOUT_MS. A handful of migrate-time
 * backfill scripts (packages/db/src/scripts/backfill-*.ts) pass a longer value explicitly: unlike
 * request/worker-path queries, several of those run one unbatched statement over an entire table
 * every deploy (by design - see e.g. backfill-event-actor-attribution.ts) and are already bounded
 * at the process level instead (docker-entrypoint.sh wraps each in `timeout 120`).
 */
export function createPrismaAdapter(
  connectionString: string | undefined,
  options?: { statementTimeoutMs?: number },
) {
  return new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 300_000,
    statement_timeout: options?.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
  });
}
