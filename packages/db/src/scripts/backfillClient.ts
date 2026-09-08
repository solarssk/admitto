import { PrismaClient } from "../generated/prisma/client.js";
import { createPrismaAdapter } from "../adapter.js";

/**
 * Migrate-time backfill scripts run one unbatched statement over an entire table by design (see
 * e.g. backfill-event-actor-attribution.ts) and are already bounded at the process level instead
 * - docker-entrypoint.sh wraps each in `timeout 120`. A dedicated client with a longer statement
 * timeout, set just under that external bound, avoids adapter.ts's default (tuned for the much
 * shorter request/worker-path queries that share the app's singleton client) firing first and
 * masking the intended process-level fail-safe with a Postgres-side error instead.
 */
export const BACKFILL_STATEMENT_TIMEOUT_MS = 110_000;

/** Builds a standalone PrismaClient for a backfill CLI script - never the app's shared
 * singleton (packages/db/src/index.ts), whose statement timeout is tuned for OLTP queries. */
export function createBackfillPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: createPrismaAdapter(process.env["DATABASE_URL"], {
      statementTimeoutMs: BACKFILL_STATEMENT_TIMEOUT_MS,
    }),
  });
}
