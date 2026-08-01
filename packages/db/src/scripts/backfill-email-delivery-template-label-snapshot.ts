import { prisma } from "../index.js";
import { backfillEmailDeliveryTemplateLabelSnapshot } from "../backfill-email-delivery-template-label-snapshot.js";

/** Deploy/CLI entrypoint: idempotent EmailDelivery.template_label_snapshot backfill after migrations. */
async function main(): Promise<void> {
  const result = await backfillEmailDeliveryTemplateLabelSnapshot(prisma);
  console.log(`backfill-email-delivery-template-label-snapshot: updated ${result.updated} delivery(ies)`);
  await prisma.$disconnect();
}

try {
  await main();
} catch (err: unknown) {
  console.error(err);
  process.exit(1);
}
