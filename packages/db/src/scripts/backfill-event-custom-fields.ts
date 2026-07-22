import { prisma } from "../index.js";
import { backfillEventCustomFields } from "../backfill-event-custom-fields.js";

/** Deploy/CLI entrypoint: idempotent EventCustomField registry backfill after migrations. */
async function main(): Promise<void> {
  const result = await backfillEventCustomFields(prisma);
  console.log(
    `backfill-event-custom-fields: updated ${result.itemsUpdated} item(s), created ${result.fieldsCreated} field(s)`,
  );
  for (const conflict of result.conflicts) {
    console.warn(`backfill-event-custom-fields: conflict - ${conflict}`);
  }
  for (const skip of result.skipped) {
    console.warn(`backfill-event-custom-fields: skipped - ${skip}`);
  }
  await prisma.$disconnect();
}

try {
  await main();
} catch (err: unknown) {
  console.error(err);
  process.exit(1);
}
