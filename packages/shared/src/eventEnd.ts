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

/** UTC instant at which the event is over: `eventHoursEnd` on the event's day in its own
 * timezone, or - without a usable end time - the end of that day (the next local midnight). An
 * overnight event (end earlier than its own start) ends on the calendar day after `date`. An
 * unknown timezone falls back to UTC rather than throwing, since the answer only gates a public
 * page. */
export function eventEndsAtUtc(event: EventEndInput): Date {
  // An unreadable date has no end: NaN compares as "not over", so nothing is closed by mistake.
  if (Number.isNaN(event.date.getTime())) return new Date(Number.NaN);
  const end = event.eventHoursEnd && HH_MM.test(event.eventHoursEnd) ? event.eventHoursEnd : null;
  const start = event.eventHoursStart && HH_MM.test(event.eventHoursStart) ? event.eventHoursStart : null;
  const overnight = end !== null && start !== null && end < start;

  const day = end === null ? utcDay(event.date, 1) : utcDay(event.date, overnight ? 1 : 0);
  const wallClock = end === null ? "00:00:00.000" : `${end}:00.000`;
  try {
    return new Date(zonedWallClockToUtcIso(day, wallClock, event.timezone));
  } catch {
    return new Date(zonedWallClockToUtcIso(day, wallClock, "UTC"));
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
