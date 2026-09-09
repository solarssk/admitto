/**
 * @admitto/db/testing — PrismaClient construction helper for unit/integration tests only.
 * Do not import from application code.
 */
import { PrismaClient } from "./generated/prisma/client.js";
import { createPrismaAdapter } from "./adapter.js";

/**
 * Builds a PrismaClient wired with the same Postgres driver adapter application code uses.
 * Defaults to DATABASE_URL, matching the old zero-arg `new PrismaClient()` tests used before
 * Prisma ORM v7 made driver adapters mandatory. Pass an explicit connectionString to point at a
 * different database — e.g. the isolated database checkin-toctou.test.ts previously selected via
 * the now-removed `datasources.db.url` PrismaClient constructor option.
 *
 * `schema` defaults to `process.env.TEST_SCHEMA` - unset for every workspace except apps/web's
 * parallel-safe integration project, where `test/integrationEnv.ts` sets it per Vitest worker so
 * each worker gets its own isolated copy of the schema (see provisionWorkerSchemas.ts) instead of
 * sharing one. Every other caller sees `schema: undefined`, i.e. today's unchanged "public" schema
 * behavior.
 */
export function createTestPrismaClient(
  connectionString: string = process.env.DATABASE_URL ?? "",
  schema: string | undefined = process.env.TEST_SCHEMA,
): PrismaClient {
  return new PrismaClient({ adapter: createPrismaAdapter(connectionString, { schema }) });
}
