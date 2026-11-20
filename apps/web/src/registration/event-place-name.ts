/**
 * The name of the event's place for the note under a date and time question, from the IANA zone saved for the event: `Los Angeles`
 * for `America/Los_Angeles`, `Buenos Aires` for `America/Argentina/Buenos_Aires`. A guest reads a place, not a technical id, so
 * there is no underscore and no region. The zones that name no place get a readable name instead: `UTC` for UTC and GMT, the generic long
 * name the platform has (`Eastern Time`, which does not claim standard or daylight time) for the others of one word that is not a name (`EST5EDT`) and for the fixed offsets of `Etc/` (`GMT-05:00`).
 * Never throws: a zone the platform does not know is shown by its last part.
 */
const UTC_NAMES = new Set(["UTC", "UCT", "GMT", "ZULU", "UNIVERSAL", "GREENWICH"]);

/** A one-word zone that is a place or a country (`Poland`, `Japan`), not a code such as `CET` or `EST5EDT`. */
const PLAIN_WORD = /^[A-Z][a-z]+$/;

function longName(zone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "longGeneric" }).formatToParts(new Date(0));
    return parts.filter((item) => item.type === "timeZoneName").map((item) => item.value).join("");
  } catch {
    return null;
  }
}

export function eventPlaceName(zone: string): string {
  const parts = zone.split("/");
  const last = zone.slice(zone.lastIndexOf("/") + 1).replaceAll("_", " ");
  if (parts.length > 1 && parts[0] !== "Etc") return last;
  if (UTC_NAMES.has(last.toUpperCase())) return "UTC";
  if (parts.length === 1 && PLAIN_WORD.test(last)) return last;
  return longName(zone) ?? last;
}

/** The sentence under a date and time question, which tells a guest whose clock to use. */
export function eventTimeNote(zone: string): string {
  return `Use the event's local time (${eventPlaceName(zone)}).`;
}
