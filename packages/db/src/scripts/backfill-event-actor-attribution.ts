import { prisma } from "../index.js";
import { backfillEventArchivedByUserId, backfillEventCreatedByUserId } from "../backfill-event-actor-attribution.js";

/** Deploy/CLI entrypoint: idempotent Event.created_by_user_id/archived_by_user_id backfill after migrations. */
async function main(): Promise<void> {
  const created = await backfillEventCreatedByUserId(prisma);
  const archived = await backfillEventArchivedByUserId(prisma);
  console.log(
    `backfill-event-actor-attribution: updated ${created.updated} event(s) created_by, ${archived.updated} event(s) archived_by`,
  );
  await prisma.$disconnect();
}

try {
  await main();
} catch (err: unknown) {
  console.error(err);
  process.exit(1);
}
