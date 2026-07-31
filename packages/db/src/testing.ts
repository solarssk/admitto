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
 */
export function createTestPrismaClient(connectionString: string = process.env.DATABASE_URL ?? ""): PrismaClient {
  return new PrismaClient({ adapter: createPrismaAdapter(connectionString) });
}
