import type { PrismaClient } from "@admitto/db";
import { eventEndsAtUtc } from "@admitto/shared";

export type WalletExpiryResult = {
  expired: number;
  /** Events whose passes carry an expires_at that has passed while the event itself is still going
   * (its end time was moved later and the push carrying the new date has not reached these
   * passes). Left untouched here; the next event-wide push corrects them. */
  deferredEvents: number;
};

/**
 * Flips wallet passes whose canonical `expires_at` (plan v4.2 step 6 - Admitto's own,
 * provider-independent expiration date; never the provider's own observed value, which is never
 * persisted) has passed to "expired". Active and voided passes both qualify - canonical expiry
 * outranks a manual void, the same way it outranks everything else this pass's status could be
 * carrying, but `voided_at` is left untouched as history, so a voided-then-expired row still shows
 * when and that it was voided before it expired. No provider contact at all (this is a purely
 * local fact - Admitto decided the date, not PassCreator) and no archived-event exception - an
 * event's own end time keeps mattering after the event archives, same as the rest of plan v4.2's
 * lifecycle rules.
 *
 * `expires_at` is only refreshed by the best-effort event-wide push that an end-time edit queues,
 * and that push can coalesce with one already running, so a pass can briefly carry an earlier date
 * than the event's current end. Expiring it then would flip a pass to a terminal, unrestorable
 * "expired" in the middle of the event, so a due pass is only expired once its event's own end
 * (the same eventEndsAtUtc the date was derived from) has passed as well.
 *
 * The end check and the UPDATE run together, per event, in one transaction that first locks the
 * event row (`FOR NO KEY UPDATE`, which still lets attendees and deliveries be inserted). An admin
 * who moves the end time later commits it either before that lock (the sweep then reads the new end
 * and defers) or after the sweep's transaction (the event had really ended by then). Without the
 * lock, an edit committed between reading the event and updating its passes would expire passes of
 * an event that is going again, and "expired" cannot be undone.
 *
 * One indexed lookup of the events that have due passes (`WalletPass_expires_at_pending_idx`), then
 * one short transaction per such event: there is no external rate limit to respect here, so nothing
 * is gained by batching further.
 */
export async function runWalletExpiry(db: PrismaClient, nowMs = Date.now()): Promise<WalletExpiryResult> {
  const due = { status: { in: ["active", "voided"] as string[] }, expires_at: { lte: new Date(nowMs) } };
  const candidates = await db.event.findMany({
    where: { attendees: { some: { wallet_pass: { is: due } } } },
    select: { id: true },
  });

  let expired = 0;
  let deferredEvents = 0;
  let firstError: Error | undefined;
  for (const { id } of candidates) {
    try {
      const outcome = await expireEventPasses(db, id, due, nowMs); // NOSONAR - one event at a time on purpose, so the sweep never holds more than one row lock or one pooled connection
      expired += outcome.expired;
      if (outcome.deferred) deferredEvents += 1;
    } catch (err) {
      // A lock wait or transaction timeout on one event must not starve the events after it (the
      // next tick would retry the same one first). Rethrown once every event has been tried, so
      // the worker still reports the run as failed.
      firstError ??= err instanceof Error ? err : new Error(String(err));
    }
  }
  if (firstError) throw firstError;
  return { expired, deferredEvents };
}

/** Prisma's interactive-transaction default (5 s to run, 2 s to get a connection) is shorter than
 * the sweep can legitimately take: the row lock may wait behind an admin edit, and one event can
 * hold many passes. The UPDATE itself is still bounded by the database's statement timeout. */
const EXPIRY_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

async function expireEventPasses(
  db: PrismaClient,
  eventId: string,
  due: { status: { in: string[] }; expires_at: { lte: Date } },
  nowMs: number,
): Promise<{ expired: number; deferred: boolean }> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR NO KEY UPDATE`;
    // Read after the lock, so an edit that committed while this waited is what gets checked.
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { date: true, event_hours_start: true, event_hours_end: true, timezone: true },
    });
    if (!event) return { expired: 0, deferred: false };

    const endMs = eventEndsAtUtc({
      date: event.date,
      eventHoursStart: event.event_hours_start,
      eventHoursEnd: event.event_hours_end,
      timezone: event.timezone,
    }).getTime();
    // An unreadable date (NaN) defers the event rather than closing its passes.
    if (Number.isNaN(endMs) || endMs > nowMs) return { expired: 0, deferred: true };

    const { count } = await tx.walletPass.updateMany({
      where: { ...due, attendee: { event_id: eventId } },
      data: { status: "expired" },
    });
    return { expired: count, deferred: false };
  }, EXPIRY_TX_OPTIONS);
}
