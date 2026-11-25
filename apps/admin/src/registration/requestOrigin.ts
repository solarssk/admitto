import { getTimeZoneAbbreviationForDate } from "@admitto/shared/timezones";
import type { RegistrationDetailDto } from "../api/types.js";
import { countryDisplayName } from "../components/GeoCell.js";

/** The zone the guest's browser reported, with its short name at the time the request was sent: "Europe/Warsaw (CET)". */
export function originTimeZoneText(zone: string, sentAt: string): string {
  const short = getTimeZoneAbbreviationForDate(zone, new Date(sentAt));
  return short ? `${zone} (${short})` : zone;
}

/** The approximate place of the address: "Mazovia, Poland (approximate)", or just the country when there is no region. */
export function originLocationText(country: string, region: string | null): string {
  const place = region ? `${region}, ${countryDisplayName(country)}` : countryDisplayName(country);
  return `${place} (approximate)`;
}

/** One line of the "Where it came from" block: what it is called, and what it says. `mono` is for the address. */
export interface OriginRow {
  label: string;
  text: string;
  mono?: boolean;
}

/** The lines of "Where it came from" that the request has, in the order of the window. A part that was not kept, or is not known, has no line. */
export function originRows(detail: Pick<RegistrationDetailDto, "origin" | "locale" | "created_at">): OriginRow[] {
  const { origin, locale, created_at: sentAt } = detail;
  const rows: OriginRow[] = [];
  if (origin.time_zone) rows.push({ label: "Time zone", text: originTimeZoneText(origin.time_zone, sentAt) });
  if (origin.country) rows.push({ label: "Location", text: originLocationText(origin.country, origin.region) });
  if (origin.ip) rows.push({ label: "IP address", text: origin.ip, mono: true });
  if (locale) rows.push({ label: "Language", text: locale });
  return rows;
}
