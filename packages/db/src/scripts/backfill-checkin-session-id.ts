import { prisma } from "../index.js";
import { backfillCheckInSessionIds } from "../backfill-checkin-session-id.js";

/** Deploy/CLI entrypoint: idempotent CheckIn.session_id backfill after migrations. */
async function main(): Promise<void> {
  const result = await backfillCheckInSessionIds(prisma);
  console.log(`backfill-checkin-session-id: updated ${result.updated} check-in(s)`);
  await prisma.$disconnect();
}

try {
  await main();
} catch (err: unknown) {
  console.error(err);
  process.exit(1);
}
