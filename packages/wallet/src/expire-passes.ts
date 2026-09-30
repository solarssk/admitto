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
 * One indexed lookup of the events that have due passes (`WalletPass_expires_at_pending_idx`), then
 * one UPDATE per such event: there is no external rate limit to respect here, so nothing is gained
 * by batching further.
 */
export async function runWalletExpiry(db: PrismaClient, nowMs = Date.now()): Promise<WalletExpiryResult> {
  const now = new Date(nowMs);
  const due = { status: { in: ["active", "voided"] as string[] }, expires_at: { lte: now } };
  const events = await db.event.findMany({
    where: { attendees: { some: { wallet_pass: { is: due } } } },
    select: { id: true, date: true, event_hours_start: true, event_hours_end: true, timezone: true },
  });

  let expired = 0;
  let deferredEvents = 0;
  for (const event of events) {
    const endsAt = eventEndsAtUtc({
      date: event.date,
      eventHoursStart: event.event_hours_start,
      eventHoursEnd: event.event_hours_end,
      timezone: event.timezone,
    });
    // NaN (an unreadable date) is never <= now, so such an event is deferred rather than closed.
    if (!(endsAt.getTime() <= nowMs)) {
      deferredEvents += 1;
      continue;
    }
    const { count } = await db.walletPass.updateMany({
      where: { ...due, attendee: { event_id: event.id } },
      data: { status: "expired" },
    });
    expired += count;
  }
  return { expired, deferredEvents };
}
