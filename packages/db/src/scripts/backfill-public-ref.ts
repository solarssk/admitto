import { createBackfillPrismaClient } from "./backfillClient.js";
import { backfillAgencyPublicRefs } from "../backfill-public-ref.js";

const prisma = createBackfillPrismaClient();

/** Deploy/CLI entrypoint: idempotent agency `public_ref` backfill after migrations. */
async function main(): Promise<void> {
  const result = await backfillAgencyPublicRefs(prisma);
  console.log(`backfill-public-ref: updated ${result.updated} agency attendee(s)`);
  await prisma.$disconnect();
}

try {
  await main();
} catch (err: unknown) {
  console.error(err);
  process.exit(1);
}
