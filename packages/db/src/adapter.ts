import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Builds the Postgres driver adapter Prisma ORM v7 requires for every PrismaClient instance
 * (no more implicit query engine). connectionTimeoutMillis/idleTimeoutMillis restore the
 * pre-v7 defaults (5s / 300s) — @prisma/adapter-pg v7's own defaults are 0 (no connect
 * timeout at all, i.e. a request can hang forever) and 10s idle.
 *
 * Kept in its own module (not exported from ./index.js) so callers that only need to build a
 * standalone client — the dev seed scripts, the future @admitto/db/testing helper — don't also
 * trigger index.ts's module-level singleton construction as a side effect.
 */
export function createPrismaAdapter(connectionString: string | undefined) {
  return new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 300_000,
  });
}
