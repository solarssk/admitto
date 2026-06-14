import { ensureIntegrationTestSchema } from "./ensureTestSchema.js";

export default async function integrationGlobalSetup(): Promise<void> {
  await ensureIntegrationTestSchema();
}
