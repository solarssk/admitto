import { seedAndPersist } from "./seed.js";

/** Playwright globalSetup — seeds the fixed org/event/attendee/operator this spec needs. */
export default async function globalSetup(): Promise<void> {
  const result = await seedAndPersist();
  console.log(`[e2e] seeded event ${result.eventId}, attendee ${result.attendeeId}`);
}
