/**
 * The clean-up of the state of guest sign-ins that were never finished (`RegistrationSsoState`, D-C4): a row is made when a
 * guest is sent to the company's identity provider, and the callback spends it within 10 minutes. A guest who closes the tab
 * leaves the row behind, and a spent row has no use left, so both go once the row has expired (a spent row always expires
 * within the same 10 minutes, so one rule covers both).
 *
 * A row holds no address, no `sub` and no token, so this takes no lock of the registration queue and has nothing to do with
 * erasure. Run by the worker job `registration_mail` on each tick, and not at each sign-in: a sign-in is a request of a
 * stranger, and a sweep inside it would be a way to make it cost more.
 *
 * The columns are naive UTC and the typed client writes and compares in UTC, so the comparison is made with a JavaScript
 * date, as the rows were written (no bare `NOW()`, which is read in the session's time zone).
 */
import type { PrismaClient } from "@admitto/db";

/** Rows deleted in one statement. */
export const SSO_STATE_SWEEP_BATCH_SIZE = 1000;

/** Batches one run deletes: a run is cut short, and says so, rather than hold up a worker tick. */
const MAX_BATCHES_PER_RUN = 10;

export interface SweepRegistrationSsoStatesResult {
  /** Rows deleted. */
  deleted: number;
  /** The run stopped at its limit: more may be expired. */
  more: boolean;
}

/** Deletes the states that have expired at `now` (the clock of the caller; tests set it). */
export async function sweepRegistrationSsoStates(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<SweepRegistrationSsoStatesResult> {
  let deleted = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    const rows = await prisma.registrationSsoState.findMany({
      where: { expires_at: { lt: now } },
      select: { id: true },
      orderBy: { expires_at: "asc" },
      take: SSO_STATE_SWEEP_BATCH_SIZE,
    });
    if (rows.length === 0) return { deleted, more: false };
    // The expiry is checked again: a row is only deleted if it is still expired, which it always is, but a statement that
    // names ids and nothing else is one a later change to this file could widen by mistake.
    const result = await prisma.registrationSsoState.deleteMany({
      where: { id: { in: rows.map((row) => row.id) }, expires_at: { lt: now } },
    });
    deleted += result.count;
    if (rows.length < SSO_STATE_SWEEP_BATCH_SIZE) return { deleted, more: false };
  }
  return { deleted, more: true };
}
