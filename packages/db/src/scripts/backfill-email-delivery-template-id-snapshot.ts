import { createBackfillPrismaClient } from "./backfillClient.js";
import { backfillEmailDeliveryTemplateIdSnapshot } from "../backfill-email-delivery-template-id-snapshot.js";

const prisma = createBackfillPrismaClient();

/** Deploy/CLI entrypoint: idempotent EmailDelivery.template_id_snapshot backfill after migrations. */
async function main(): Promise<void> {
  const result = await backfillEmailDeliveryTemplateIdSnapshot(prisma);
  console.log(`backfill-email-delivery-template-id-snapshot: updated ${result.updated} delivery(ies)`);
  await prisma.$disconnect();
}

try {
  await main();
} catch (err: unknown) {
  console.error(err);
  process.exit(1);
}
