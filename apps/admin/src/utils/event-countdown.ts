import { useEffect, useState } from "react";
import { formatEventDate } from "./event-dates.js";

/**
 * Countdown label for event overview — calendar-day comparison in event timezone.
 * Uses en-CA date strings (YYYY-MM-DD) in the event TZ, not 24h millisecond buckets.
 */
export function computeLabel(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  const toDay = (ms: number) =>
    new Date(ms).toLocaleDateString("en-CA", { timeZone: timezone });

  const eventDay = toDay(new Date(iso).getTime());
  const todayStr = toDay(Date.now());
  const tomorrowStr = toDay(Date.now() + 86_400_000);
  const yesterdayStr = toDay(Date.now() - 86_400_000);

  if (diff < 0) {
    if (eventDay === todayStr) return "Ended today";
    if (eventDay === yesterdayStr) return "Ended yesterday";
    return `Ended ${Math.floor(-diff / 86_400_000)} days ago`;
  }
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  if (eventDay === todayStr) return h === 0 ? "Starting soon" : `Today in ${h}h`;
  if (eventDay === tomorrowStr) return "Tomorrow";
  if (diff <= 7 * 86_400_000) return `In ${Math.floor(diff / 86_400_000)} days`;
  return formatEventDate(iso, timezone);
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
