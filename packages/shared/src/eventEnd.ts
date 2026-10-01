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

/** Local wall-clock time on the morning after the event day until which a session granted on the
 * event day may keep running, so an event that finishes late does not sign the tablet out
 * mid-shift. */
export const EVENT_DAY_GRACE_LOCAL_TIME = "06:00";

/** The window in which a sign-in counts as "on the event day", plus the instant a session granted
 * inside it should end. `start` (local midnight) is inclusive; `end` is exclusive and is the later
 * of the next local midnight and the event's own end, so an overnight event still covers a
 * sign-in at 01:00 the next morning. */
export interface EventDayWindow {
  start: Date;
  end: Date;
  sessionEnd: Date;
}

/** The event's own local calendar day, read the same way as eventEndsAtLocal (UTC components of
 * the noon-UTC `date` sentinel), with every bound converted from wall-clock time so a 23 or 25
 * hour day on a daylight-saving change still runs from local midnight to local midnight.
 * `sessionEnd` is the later of 06:00 the next morning and the event's own end (an overnight event
 * can end after 06:00). Null when the date or the timezone cannot be read: unlike eventEndsAtUtc
 * this never falls back to UTC, because it gates a longer-lived session and must fail closed. */
export function eventDayWindow(event: EventEndInput): EventDayWindow | null {
  if (Number.isNaN(event.date.getTime())) return null;
  try {
    const day = utcDay(event.date, 0);
    const nextDay = utcDay(event.date, 1);
    const start = new Date(zonedWallClockToUtcIso(day, "00:00:00.000", event.timezone));
    const end = new Date(zonedWallClockToUtcIso(nextDay, "00:00:00.000", event.timezone));
    const grace = new Date(zonedWallClockToUtcIso(nextDay, `${EVENT_DAY_GRACE_LOCAL_TIME}:00.000`, event.timezone));
    const over = eventEndsAtUtc(event);
    const later = (a: Date, b: Date) => (a.getTime() > b.getTime() ? a : b);
    return { start, end: later(end, over), sessionEnd: later(over, grace) };
  } catch {
    return null;
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
