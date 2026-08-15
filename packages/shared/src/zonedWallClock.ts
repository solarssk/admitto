/** What a UTC instant's wall clock reads as in `timeZone`, expressed as if those same digits
 * were UTC millis - the building block of the "double conversion" trick: comparing this against
 * the originally requested wall clock tells you how far off a guessed instant is. */
function readZonedWallClockAsUtcMillis(instantMillis: number, timeZone: string, ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instantMillis));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const hour = get("hour");
  return Date.UTC(get("year"), get("month") - 1, get("day"), hour === 24 ? 0 : hour, get("minute"), get("second"), ms);
}

/** UTC instant for a given wall-clock time (`HH:mm:ss.SSS`) of `yyyyMmDd` as observed in
 * `timeZone` - the "double conversion" trick: a naive guess treating the wall-clock time as
 * UTC, corrected by however far that guess's own reading (via Intl) in `timeZone` drifted from
 * what was actually asked for (the zone's UTC offset at that moment, DST included).
 *
 * A single correction pass is only exact when the offset doesn't change between the naive
 * guess and the corrected instant - false right across a DST transition, most visibly when the
 * transition itself falls at local midnight (bot review: `zonedDayStartIso("2023-04-28",
 * "Africa/Cairo")` landed on 2023-04-27T21:00Z, 23:00 the previous day locally, instead of the
 * first valid moment of April 28). Re-validating the corrected instant and correcting again
 * converges within a couple of passes for a real offset change.
 *
 * This is the one place in the monorepo that resolves a UTC instant from a local wall-clock
 * time + IANA zone - every caller needing that (event day-boundary filters in
 * `apps/admin/src/utils/event-dates.ts`, Apple Wallet semantic-tag instants in
 * `packages/tickets/src/wallet-pass-input.ts`) goes through this, rather than each maintaining
 * its own approximation - a simpler "treat the wall-clock digits as UTC, probe the offset once"
 * shortcut looks correct for most zones/times but silently returns the wrong offset (and,
 * downstream, a wrong duration) for a same-day start/end pair that straddles a DST transition in
 * a zone with a non-zero standard offset (confirmed for a 01:00-03:00 America/New_York event on
 * 2026-03-08, the US spring-forward date: the naive probe puts both bounds on the pre-transition
 * side, computing a 2-hour duration for what is actually a 1-hour local span). */
export function zonedWallClockToUtcIso(yyyyMmDd: string, hhMmSsMs: string, timeZone: string): string {
  const target = new Date(`${yyyyMmDd}T${hhMmSsMs}Z`).getTime();
  const ms = new Date(target).getUTCMilliseconds();

  let candidate = target;
  let readBack = readZonedWallClockAsUtcMillis(candidate, timeZone, ms);
  for (let i = 0; i < 3 && readBack !== target; i++) {
    candidate += target - readBack;
    readBack = readZonedWallClockAsUtcMillis(candidate, timeZone, ms);
  }

  if (readBack !== target) {
    // The requested wall-clock time doesn't exist in `timeZone` - a spring-forward transition
    // skipped straight over it (e.g. local midnight itself). Re-correcting from here just
    // oscillates between the last valid instant before the gap and the first one after it;
    // resolve to the earliest instant that reads back on or after what was actually asked for,
    // so a "day start" bound can't slip back into the previous day.
    const other = candidate + (target - readBack);
    const otherReadBack = readZonedWallClockAsUtcMillis(other, timeZone, ms);
    const options = [
      { instant: candidate, readBack },
      { instant: other, readBack: otherReadBack },
    ].sort((a, b) => a.readBack - b.readBack);
    candidate = (options.find((o) => o.readBack >= target) ?? options.at(-1)!).instant;
  }

  return new Date(candidate).toISOString();
}
