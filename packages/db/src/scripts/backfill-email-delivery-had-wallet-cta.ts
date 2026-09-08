import { createBackfillPrismaClient } from "./backfillClient.js";
import { backfillEmailDeliveryHadWalletCta } from "../backfill-email-delivery-had-wallet-cta.js";

const prisma = createBackfillPrismaClient();

/** Deploy/CLI entrypoint: idempotent EmailDelivery.had_wallet_cta backfill after migrations. */
async function main(): Promise<void> {
  const result = await backfillEmailDeliveryHadWalletCta(prisma);
  console.log(`backfill-email-delivery-had-wallet-cta: updated ${result.updated} delivery(ies)`);
  await prisma.$disconnect();
}

try {
  await main();
} catch (err: unknown) {
  console.error(err);
  process.exit(1);
}
