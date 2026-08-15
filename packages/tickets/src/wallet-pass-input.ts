import type { PrismaClient } from "@admitto/db";
import type { WalletPassInput, WalletPassSemantics } from "@admitto/wallet";
import { isMapReady, resolveAppleMapsUrl, resolveGoogleMapsUrl } from "@admitto/location";
import { loadEventTicketTypes } from "./ticket-types.js";
import type { resolveTicket } from "./resolve.js";
import { formatDate, formatEventHour } from "./region-date-format.js";

type ResolvedTicket = NonNullable<Awaited<ReturnType<typeof resolveTicket>>>;

export { formatDate };

/**
 * ticket_type stores the catalog key (e.g. "press_pass"), not the human label ("Press Pass") -
 * resolve it for attendee-facing display; fail open to the raw key on any lookup error, same as
 * ticketTypeBadge.tsx's resolver (Codex review, batch 04 / #351). Its own module (not a createApp
 * closure) so the admin reissue action can produce the exact same wallet pass content as the
 * on-demand create/redirect flow, not a hand-maintained copy.
 */
export async function resolveTicketPageDisplay(
  db: PrismaClient,
  resolved: ResolvedTicket,
): Promise<ResolvedTicket> {
  const { attendee, event } = resolved;
  if (!attendee.ticket_type) return resolved;
  try {
    const catalog = await loadEventTicketTypes(db, event.id);
    const found = catalog.find((t) => t.key === attendee.ticket_type);
    if (!found) return resolved;
    return { ...resolved, attendee: { ...attendee, ticket_type: found.label } };
  } catch (err) {
    console.error("loadEventTicketTypes failed for ticket page:", err);
    return resolved;
  }
}

/** "HH:MM-HH:MM" for the pass (each bound in the event's regional convention, see
 * region-date-format.ts), or undefined when either bound is unset (independently optional). */
function formatEventHours(
  event: { eventHoursStart: string | null; eventHoursEnd: string | null },
  country: string | null | undefined,
): string | undefined {
  if (!event.eventHoursStart || !event.eventHoursEnd) return undefined;
  return `${formatEventHour(event.eventHoursStart, country)}-${formatEventHour(event.eventHoursEnd, country)}`;
}

/** UTC offset suffix ("+02:00" / "-05:00" / "Z") for `timeZone` at `instant` - `instant` must be
 * the actual local wall-clock time being formatted (see zonedDateTimeToIso), not just any instant
 * on the right calendar day: on a DST transition day, the offset can differ between the morning
 * and the evening of the same day, so sampling the wrong instant emits the wrong offset for a
 * time near the transition (bot review). Node/V8's `longOffset` gives "GMT+02:00" (or bare "GMT"
 * for UTC); the regex also tolerates an unpadded "GMT+2" in case of ICU data variance across
 * environments. */
function tzOffsetSuffix(instant: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName")?.value;
  if (!part || part === "GMT") return "Z";
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(part);
  if (!match) return "Z";
  const [, sign, hours = "00", minutes = "00"] = match;
  // "+00:00" is UTC too (some ICU builds emit "GMT+00:00" for UTC rather than bare "GMT") -
  // normalize to the more conventional "Z" rather than leaking the engine-specific spelling.
  if (hours === "00" && minutes === "00") return "Z";
  return `${sign}${hours.padStart(2, "0")}:${minutes}`;
}

/** Combines the event's calendar day with a display-only "HH:MM" wall-clock time into a real,
 * offset-aware ISO 8601 instant for Apple's `eventStartDate`/`eventEndDate` semantic tags -
 * undefined for a missing/malformed time rather than guessing, since a wrong instant would be
 * worse for Siri Suggestions than omitting the field entirely.
 *
 * The calendar day comes from `date`'s own UTC components, never from re-formatting `date` in
 * `timeZone` - `date` is itself a display-only sentinel anchored at noon UTC (see formatDate
 * above), and re-deriving the day via the *event's* timezone can push a UTC+12-or-further-east
 * zone (e.g. Pacific/Kiritimati, UTC+14) to the *next* calendar day, corrupting the stored event
 * date (bot review: P1, "Keep the stored event day when formatting semantics").
 *
 * The offset is resolved at a naive instant built from that same day plus `hhmm`, treated as if
 * it were UTC (`Date.UTC(y, m, d, hh, mm)`) - close enough to land on the correct side of a DST
 * transition for the *actual* local time being formatted, unlike passing the noon-UTC `date`
 * through unchanged (bot review: P2, "Resolve the offset at the event's wall-clock time"). This
 * can only be wrong within the transition's own ~1h gap/overlap, an inherent ambiguity of civil
 * time - not something resolvable from a plain "HH:MM" with no UTC offset of its own. */
function zonedDateTimeToIso(date: Date, hhmm: string | null, timeZone: string): string | undefined {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return undefined;
  const [hh = 0, mm = 0] = hhmm.split(":").map(Number);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const naiveInstant = new Date(Date.UTC(y, m, d, hh, mm));
  const dayStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return `${dayStr}T${hhmm}:00${tzOffsetSuffix(naiveInstant, timeZone)}`;
}

/** Builds Apple Wallet semantic tag values from the resolved event/attendee - only the fields
 * Admitto's domain model actually has data for (ADR 0009 data minimization); no invented
 * defaults beyond the fixed "PKEventTypeGeneric" eventType, which is valid for any event and
 * unlocks the rest of the vocabulary being considered well-formed by Apple/PassCreator. */
function buildSemantics(resolved: ResolvedTicket): WalletPassSemantics | undefined {
  const { attendee, event } = resolved;
  const mapReady = isMapReady(event);
  // An overnight event (end time earlier than start time) ends on the calendar day *after*
  // event.date - without this, eventEndDate would land before eventStartDate on the same day,
  // which is exactly backwards for Apple's semantic tags. event.date is anchored at noon UTC
  // (see formatDate above), so +24h in UTC always lands on the next calendar day in any
  // timezone, the same reasoning that anchoring already relies on.
  const isOvernight = !!event.eventHoursStart && !!event.eventHoursEnd && event.eventHoursEnd < event.eventHoursStart;
  const eventEndDateBase = isOvernight ? new Date(event.date.getTime() + 24 * 60 * 60 * 1000) : event.date;
  const eventStartDate = zonedDateTimeToIso(event.date, event.eventHoursStart, event.timezone);
  const eventEndDate = zonedDateTimeToIso(eventEndDateBase, event.eventHoursEnd, event.timezone);
  // Derived from the resolved instants (real elapsed seconds), not wall-clock HH:MM subtraction -
  // a DST transition between start and end otherwise makes duration disagree with the emitted
  // eventStartDate/eventEndDate pair (bot review: P2, "Compute duration from the resolved event
  // instants" - e.g. a 22:00-02:00 event crossing a spring-forward is 3 real hours, not 4).
  const duration =
    eventStartDate && eventEndDate
      ? Math.round((Date.parse(eventEndDate) - Date.parse(eventStartDate)) / 1000)
      : undefined;
  const semantics: WalletPassSemantics = {
    eventName: event.title || undefined,
    eventType: "PKEventTypeGeneric",
    eventStartDate,
    eventEndDate,
    venueName: event.location || undefined,
    venueLocation: mapReady ? { latitude: event.latitude!, longitude: event.longitude! } : undefined,
    entranceDescription: event.directionsText || undefined,
    attendeeName: attendee.name || undefined,
    duration: duration && duration > 0 ? duration : undefined,
  };
  return semantics;
}

/**
 * Maps an already display-resolved ticket (see resolveTicketPageDisplay) into the provider-neutral
 * WalletPassInput shape. `barcodeValue` is the caller's concern - the on-demand flow threads
 * through the same QR payload the attendee's own ticket page encodes, and reissue must reuse that
 * exact same value (never mint a new one, or the pass's barcode stops matching the real ticket).
 */
export function buildWalletPassInput(resolved: ResolvedTicket, barcodeValue: string): WalletPassInput {
  const { attendee, event } = resolved;
  const mapLabel = event.location ?? event.formattedAddress ?? undefined;
  const mapReady = isMapReady(event);
  return {
    attendeeName: attendee.name,
    attendeeFirstNameLabel: attendee.first_name || undefined,
    attendeeLastNameLabel: attendee.last_name || undefined,
    attendeeEmailLabel: attendee.email || undefined,
    attendeeCompanyLabel: attendee.company || undefined,
    attendeeDepartmentLabel: attendee.department || undefined,
    eventNameLabel: event.title,
    eventDateLabel: formatDate(event.date, event.addressComponents?.country),
    eventHoursLabel: formatEventHours(event, event.addressComponents?.country),
    eventLocationLabel: event.location || undefined,
    directionsTextLabel: event.directionsText || undefined,
    accessibilityTextLabel: event.accessibilityText || undefined,
    googleMapsUrlLabel: mapReady
      ? resolveGoogleMapsUrl(event.latitude!, event.longitude!, mapLabel, event.googleMapsUrlOverride)
      : undefined,
    appleMapsUrlLabel: mapReady
      ? resolveAppleMapsUrl(event.latitude!, event.longitude!, mapLabel, event.appleMapsUrlOverride)
      : undefined,
    addressObjectNameLabel: event.addressComponents?.object_name || undefined,
    addressStreetLabel: event.addressComponents?.street || undefined,
    addressPostcodeLabel: event.addressComponents?.postcode || undefined,
    addressCityLabel: event.addressComponents?.city || undefined,
    addressRegionLabel: event.addressComponents?.region || undefined,
    addressCountryLabel: event.addressComponents?.country || undefined,
    ticketTypeLabel: attendee.ticket_type || "General",
    userProvidedId: `admitto:${event.id}:${attendee.id}`,
    barcodeValue,
    // Apple-only, opt-in (Event Settings -> Wallet -> Apple Wallet -> Semantic tags): gated on
    // walletAppleEnabled too so a Google-only event never sends Apple-specific data to
    // PassCreator, even though PassCreator itself would just ignore it for Google rendering.
    semantics:
      event.walletSemanticTagsEnabled && event.walletAppleEnabled ? buildSemantics(resolved) : undefined,
  };
}
