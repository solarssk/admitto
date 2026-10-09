import type { PrismaClient } from "@admitto/db";
import { lockAttendeeRow, lockLiveAttendees } from "./attendee-lock.js";

/** A transaction that only takes locks may have to wait for an erasure's own transaction, which
 * Prisma's default 5 s would cut off. */
const LOCK_CHECK_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

/**
 * The last check before something leaves Admitto for an attendee (a wallet pass update, a push
 * message): do they still exist and are they not erased? Read under their row lock, in a short
 * transaction of its own. An erasure that is still open is waited for and its result seen, where
 * a plain read would still show the attendee as they were before it began.
 *
 * The lock ends with the transaction, a moment before the call to the provider, so a request the
 * provider already holds when an erasure commits is not recalled.
 */
export function attendeeIsLive(db: PrismaClient, attendeeId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const locked = await lockAttendeeRow(tx, attendeeId);
    return locked !== null && !locked.erased;
  }, LOCK_CHECK_TX_OPTIONS);
}

/** The same check for several attendees at once (one batch of a push message): the ids of those
 * that exist and are not erased. */
export function liveAttendeeIds(db: PrismaClient, attendeeIds: readonly string[]): Promise<Set<string>> {
  return db.$transaction((tx) => lockLiveAttendees(tx, attendeeIds), LOCK_CHECK_TX_OPTIONS);
}
