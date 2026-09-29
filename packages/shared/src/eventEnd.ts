import { zonedWallClockToUtcIso } from "./zonedWallClock.js";

/** The event fields that decide when an event is over. `date` is the display-only sentinel
 * anchored at noon UTC (see packages/tickets/src/wallet-pass-input.ts), so the calendar day is
 * read from its UTC components, never re-derived in the event's own timezone. */
export interface EventEndInput {
  date: Date;
  eventHoursStart: string | null;
  eventHoursEnd: string | null;
  timezone: string;
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** yyyy-mm-dd of `date`'s UTC calendar day, `offsetDays` later. */
function utcDay(date: Date, offsetDays: number): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offsetDays))
    .toISOString()
    .slice(0, 10);
}

/** The event's own local calendar day and "HH:mm" at which it is over - `eventHoursEnd` on
 * `date`'s day, or, without a usable end time, the next local midnight. An overnight event (end
 * earlier than its own start) ends on the calendar day after `date`. Null for an unreadable
 * `date`, since there is no day to report. Split out of eventEndsAtUtc below so a naive,
 * provider-bound wall-clock string (WalletPass.expires_at's own expirationDate push, plan v4.2
 * step 6 - see computeExpirationDateLabel, packages/tickets/src/wallet-pass-input.ts) can share
 * these exact day/overnight rules instead of re-deriving them (AGENTS.md's duplication-gate
 * note). */
export function eventEndsAtLocal(event: EventEndInput): { day: string; time: string } | null {
  if (Number.isNaN(event.date.getTime())) return null;
  const end = event.eventHoursEnd && HH_MM.test(event.eventHoursEnd) ? event.eventHoursEnd : null;
  const start = event.eventHoursStart && HH_MM.test(event.eventHoursStart) ? event.eventHoursStart : null;
  const overnight = end !== null && start !== null && end < start;
  return { day: utcDay(event.date, end === null || overnight ? 1 : 0), time: end ?? "00:00" };
}

/** UTC instant at which the event is over (see eventEndsAtLocal above for the day/time this reads
 * off). An unknown timezone falls back to UTC rather than throwing, since the answer only gates a
 * public page. */
export function eventEndsAtUtc(event: EventEndInput): Date {
  const local = eventEndsAtLocal(event);
  // An unreadable date has no end: NaN compares as "not over", so nothing is closed by mistake.
  if (!local) return new Date(Number.NaN);
  const wallClock = `${local.time}:00.000`;
  try {
    return new Date(zonedWallClockToUtcIso(local.day, wallClock, event.timezone));
  } catch {
    return new Date(zonedWallClockToUtcIso(local.day, wallClock, "UTC"));
  }
}

/** True once an attendee may no longer add a wallet pass for this event: it is archived, or it is
 * over (see eventEndsAtUtc). Shared by the public Add to Wallet route, the ticket page (which
 * hides the buttons) and the server-side Restore gate, so all three agree on one moment. */
export function isWalletAddClosed(
  event: EventEndInput & { archivedAt: Date | null },
  now: Date = new Date(),
): boolean {
  // Loose on purpose: a row selected without `archived_at` reads as undefined, never as archived.
  return Boolean(event.archivedAt) || now.getTime() >= eventEndsAtUtc(event).getTime();
}
