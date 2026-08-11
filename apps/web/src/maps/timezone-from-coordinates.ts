import { find as findTimezones } from "geo-tz";
import { normalizeTimeZone } from "@admitto/shared/timezones";

/**
 * Resolve the primary IANA timezone for a map pin. Runs on the server only — `geo-tz`
 * needs Node (`__dirname` + `geo.dat`) and cannot be bundled into the staff SPA.
 */
export function timezoneFromCoordinates(latitude: number, longitude: number): string | null {
  try {
    const zones = findTimezones(latitude, longitude);
    const timezone = zones[0];
    return timezone ? (normalizeTimeZone(timezone) ?? timezone) : null;
  } catch {
    return null;
  }
}
