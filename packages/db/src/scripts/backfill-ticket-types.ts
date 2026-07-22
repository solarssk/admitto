import { prisma } from "../index.js";
import { backfillTicketTypes } from "../backfill-ticket-types.js";

/** Deploy/CLI entrypoint: idempotent per-event TicketType catalog backfill after migrations. */
async function main(): Promise<void> {
  const result = await backfillTicketTypes(prisma);
  console.log(
    `backfill-ticket-types: seeded ${result.eventsSeeded} event(s), created ${result.typesCreated} type(s), normalized ${result.attendeesNormalized} attendee(s)`,
  );
  await prisma.$disconnect();
}

try {
  await main();
} catch (err: unknown) {
  console.error(err);
  process.exit(1);
}
