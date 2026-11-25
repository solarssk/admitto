/**
 * What a registration request keeps of where it came from (the columns `Registration.submitted_*` and `locale`): read from the request of
 * the guest's browser, and saved only for an event whose switch `keep_origin` is on (Event settings, Registration, Handling requests).
 *
 * - The address is the client address the rate limits use (`resolveClientIp`: the socket, or the rightmost hop of X-Forwarded-For that is not
 *   one of our own proxies, and only while TRUST_PROXY allows it), so a guest cannot choose what is stored by sending a header.
 * - The place comes from the GeoIP data the instance already has (`resolveIpLocation`): the ISO country and, when the dataset carries it, the
 *   region. Never a city. With no database, an address with no entry or a private address it is empty, and nothing fails.
 * - The time zone is what the page's script reported. It is accepted only when it is one of the zones the product knows, and then in the
 *   product's own spelling; anything else is dropped without a word, so a body is never refused for it.
 *
 * Personal data: none of it is written to a log, an error or an audit entry. The language (`localeOf`) is not part of the switch: it is the
 * language the guest's browser asks for, kept for the mails, and the event may keep it whether or not it keeps the origin.
 */
import type { Context } from "hono";
import type { RegistrantSubmission, RegistrationOrigin } from "@admitto/tickets";
import { normalizeTimeZone } from "@admitto/shared/timezones";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import { resolveIpLocation } from "../rate-limit/ip-location.js";

/** The longest language tag kept. The longest real ones (with script, region and variants) are shorter. */
const MAX_LOCALE_LENGTH = 35;

/** The zone the page reported, in the product's spelling, or null when it is not a text or not a zone the product knows. */
export function timeZoneOf(raw: unknown): string | null {
  return typeof raw === "string" ? normalizeTimeZone(raw) : null;
}

/** The first language the browser asks for (`Accept-Language`), as a canonical tag (`pl-PL`), or null when there is none or it is not a tag. */
export function localeOf(header: string | undefined): string | null {
  const first = (header ?? "").split(",", 1)[0]!.split(";", 1)[0]!.trim();
  if (first === "" || first.length > MAX_LOCALE_LENGTH) return null;
  try {
    return Intl.getCanonicalLocales(first)[0]!;
  } catch {
    return null;
  }
}

/** The origin of the request: the client address, its approximate place, and the zone the page reported (`rawTimeZone`, the body's `time_zone`). */
export function readSubmissionOrigin(c: Context, rawTimeZone: unknown): RegistrationOrigin {
  const client = resolveClientIp(c);
  const ip = client === "unknown" ? null : client;
  const location = resolveIpLocation(ip);
  return { ip, time_zone: timeZoneOf(rawTimeZone), country: location.countryCode ?? null, region: location.region ?? null };
}

/** The registrant with what the request says of where it came from: the language always, the origin only when the event keeps it. */
export function withOrigin(c: Context, registrant: RegistrantSubmission, keepOrigin: boolean, rawTimeZone: unknown): RegistrantSubmission {
  const withLanguage = { ...registrant, locale: localeOf(c.req.header("accept-language")) };
  return keepOrigin ? { ...withLanguage, origin: readSubmissionOrigin(c, rawTimeZone) } : withLanguage;
}
