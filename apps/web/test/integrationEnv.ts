import { WEB_TEST_DATABASE_URL } from "./testEnv.js";
import { INTEGRATION_TEST_WORKER_COUNT, workerSchemaName } from "./provisionWorkerSchemas.js";

/** Vitest fork workers inherit CI job `DATABASE_URL` (main DB) unless overridden. */
process.env.DATABASE_URL = WEB_TEST_DATABASE_URL;

// VITEST_POOL_ID is Vitest's own 1..maxWorkers pool-slot id (stable for a given worker's
// lifetime, unique among concurrently running workers - see vitest's own worker/init source).
// @admitto/db/testing's createTestPrismaClient() defaults its `schema` param from TEST_SCHEMA, so
// every test file's own `createTestPrismaClient()` call (unchanged - none of the ~60 call sites in
// this project need to know about this) transparently lands on this worker's isolated schema
// instead of the shared `public` one. Fail loudly rather than silently fall back to `public` (and
// therefore silently lose isolation) if maxWorkers ever exceeds how many schemas were actually
// provisioned - see provisionWorkerSchemas.ts's own comment on why these two numbers must match.
const poolId = Number(process.env.VITEST_POOL_ID ?? "1");
if (!Number.isInteger(poolId) || poolId < 1 || poolId > INTEGRATION_TEST_WORKER_COUNT) {
  throw new Error(
    `VITEST_POOL_ID=${process.env.VITEST_POOL_ID} is outside the provisioned range ` +
      `1..${INTEGRATION_TEST_WORKER_COUNT} - update INTEGRATION_TEST_WORKER_COUNT (and this ` +
      `project's maxWorkers) together, never just one.`,
  );
}
process.env.TEST_SCHEMA = workerSchemaName(poolId);
