import { ensureIntegrationTestSchema } from "./ensureTestSchema.js";
import { INTEGRATION_TEST_WORKER_COUNT, provisionWorkerSchemas } from "./provisionWorkerSchemas.js";
import { RedisContainer } from "@testcontainers/redis";

let redisStop: (() => Promise<void>) | undefined;

export default async function integrationGlobalSetup(): Promise<() => Promise<void>> {
  await ensureIntegrationTestSchema();
  // Must run after the line above: it dumps `public`'s current structure to build each worker's
  // isolated schema, so `public` needs to already be fully migrated first.
  await provisionWorkerSchemas(INTEGRATION_TEST_WORKER_COUNT);

  // Start Redis only when not already provided (CI sets REDIS_URL via service container).
  if (!process.env.REDIS_URL) {
    const container = await new RedisContainer("redis:7-alpine").start();
    process.env.REDIS_URL = container.getConnectionUrl();
    redisStop = async () => { await container.stop(); };
  }

  return async () => {
    await redisStop?.();
  };
}
