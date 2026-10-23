import type { Prisma } from "@admitto/db";
import type { RegistrationMode } from "@admitto/db/status";
import { readRegistrationCompanions } from "./attendee-companion.js";
import { countSeatsInUse } from "./event-seats.js";

/**
 * The seats a registration takes once it is accepted: the guest and each companion (D-B3, D-E5). The companions are
 * those the admission will write (readRegistrationCompanions), so the seats a registration is given and the rows it
 * gets are always the same number.
 */
export function seatsNeeded(companions: Prisma.JsonValue): number {
  return 1 + readRegistrationCompanions(companions).length;
}

/**
 * The seats the event has left: its limit minus the seats in use (countSeatsInUse, the one count), never below
 * zero, so an event that is over its limit (D-B7) has none. Infinity for an event without a limit. Read under
 * the capacity lock, or the answer can be out of date when it is used.
 */
export async function readFreeSeats(
  tx: Prisma.TransactionClient,
  eventId: string,
  capacity: number | null,
): Promise<number> {
  if (capacity === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, capacity - (await countSeatsInUse(tx, eventId)));
}

/** The registrations on the waiting list. Read under the registration queue. */
export function countWaitlisted(tx: Prisma.TransactionClient, eventId: string): Promise<number> {
  return tx.registration.count({ where: { event_id: eventId, status: "waitlist" } });
}

/** Where a registration lands once nothing holds it back (its address needs no confirmation, or has been confirmed). */
export type PlacedStatus = "accepted" | "pending" | "waitlist";

/**
 * The one rule that says where a new guest goes (D-B2 to D-B6, D-B16), shared by a submission and by the
 * confirmation of an address:
 * - the seats are enough and nobody waits for them: accepted in an automatic event, pending (an organiser
 *   decides) in one with approval;
 * - no seat for the guest: the waiting list (D-B5), or `full` when the event has none (D-B6): nothing is stored;
 * - D-B16: while guests wait, a new guest of an automatic event queues behind them instead of taking a free seat,
 *   which stays for the organiser to give. An event with approval has no such seat to fill (every guest waits
 *   for the organiser), and an event whose waiting list was switched off ignores the guests still on it.
 * The waiting list is manual (D-B5): nothing here, or anywhere, moves a guest off it when a seat frees up.
 */
export function decidePlacement(
  settings: { mode: RegistrationMode; waitlist_enabled: boolean },
  seats: { free: number; waitlisted: number },
  needed: number,
): PlacedStatus | "full" {
  const fits = seats.free >= needed;
  const shouldWaitlist = settings.mode === "automatic" && settings.waitlist_enabled && seats.waitlisted > 0;
  if (fits && !shouldWaitlist) return settings.mode === "automatic" ? "accepted" : "pending";
  return settings.waitlist_enabled ? "waitlist" : "full";
}
