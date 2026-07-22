import { useEffect, useState } from "react";
import { formatEventCalendarDate } from "./event-dates.js";

function calendarDayInTz(ms: number, timezone: string): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: timezone });
}

/** UTC calendar day from stored event date (date-only values are persisted at UTC noon). */
function eventCalendarDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function addCalendarDays(dayStr: string, days: number): string {
  const [y, m, d] = dayStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function calendarDaysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

function daysUntilInTz(iso: string, timezone: string): number {
  const eventDay = eventCalendarDay(iso);
  const todayStr = calendarDayInTz(Date.now(), timezone);
  return calendarDaysBetween(todayStr, eventDay);
}

/**
 * Raw day count until the event (negative once it's past), event-timezone calendar comparison.
 * For KPI tiles that need a number — computeLabel() intentionally falls back to a calendar date
 * past 7 days out (fine for a prose header chip), which is the wrong shape for a numeric tile.
 */
export function daysUntilEvent(iso: string | null, timezone: string): number | null {
  if (!iso) return null;
  return daysUntilInTz(iso, timezone);
}

/**
 * Countdown label for event overview — calendar-day comparison in event timezone.
 * Event day comes from the stored UTC calendar date; “today” is evaluated in event TZ.
 */
export function computeLabel(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();

  const eventDay = eventCalendarDay(iso);
  const todayStr = calendarDayInTz(Date.now(), timezone);
  const tomorrowStr = addCalendarDays(todayStr, 1);
  const yesterdayStr = addCalendarDays(todayStr, -1);
  const daysUntil = daysUntilInTz(iso, timezone);
  const daysSince = calendarDaysBetween(eventDay, todayStr);

  // Event TZ calendar already past the stored day while UTC-noon sentinel is still ahead (+14 edge case).
  if (daysSince > 0) {
    if (eventDay === yesterdayStr) return "Ended yesterday";
    return `Ended ${daysSince} days ago`;
  }

  if (diff < 0) {
    if (eventDay === todayStr) return "Ended today";
    if (eventDay === yesterdayStr) return "Ended yesterday";
    return `Ended ${daysSince} days ago`;
  }

  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  if (daysUntil === 0) return h === 0 ? "Starting soon" : `Today in ${h}h`;
  if (daysUntil === 1) return "Tomorrow";
  if (daysUntil <= 7 && daysUntil > 0) return `In ${daysUntil} days`;
  return formatEventCalendarDate(iso);
}

/** Live countdown label; refreshes every minute. */
export function useCountdown(targetDateIso: string | null, timezone: string): string {
  const [label, setLabel] = useState<string>(() => computeLabel(targetDateIso, timezone));

  useEffect(() => {
    const tick = () => setLabel(computeLabel(targetDateIso, timezone));
    tick();
    if (!targetDateIso) return;
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [targetDateIso, timezone]);

  return label;
}
