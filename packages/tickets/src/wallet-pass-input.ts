import type { PrismaClient } from "@admitto/db";
import type { WalletPassInput } from "@admitto/wallet";
import { isMapReady, resolveAppleMapsUrl, resolveGoogleMapsUrl } from "@admitto/location";
import { zonedWallClockToUtcIso } from "@admitto/shared";
import { loadEventTicketTypes } from "./ticket-types.js";
import type { resolveTicket } from "./resolve.js";
import { formatDate, formatDateShort, formatEventHoursRange } from "@admitto/shared/region-date-format";

type ResolvedTicket = NonNullable<Awaited<ReturnType<typeof resolveTicket>>>;

export { formatDate, formatDateShort };

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

/** Event-hours label for the pass, byte-identical in wording to the public ticket page (same
 * {@link formatEventHoursRange}: spaced dash, open-ended "from"/"until" when only one bound is
 * set, zone abbreviation suffix) - a wallet field is flat text with no separate de-emphasized
 * span for the zone abbreviation, so it's appended directly onto the same string here. */
function formatEventHours(
  event: { eventHoursStart: string | null; eventHoursEnd: string | null; timezone: string; date: Date },
  country: string | null | undefined,
): string | undefined {
  const range = formatEventHoursRange(event.eventHoursStart, event.eventHoursEnd, country, event.timezone, event.date);
  if (!range) return undefined;
  return range.tzAbbr ? `${range.hours} ${range.tzAbbr}` : range.hours;
}

/** UTC offset suffix ("+02:00" / "-05:00" / "Z") for `timeZone` at `instant` - `instant` must be
 * the actual, correctly-resolved local wall-clock instant being formatted (see
 * zonedDateTimeToIso), not just any instant on the right calendar day: on a DST transition day,
 * the offset can differ between the morning and the evening of the same day, so sampling the
 * wrong instant emits the wrong offset for a time near the transition. Node/V8's `longOffset`
 * gives "GMT+02:00" (or bare "GMT" for UTC); the regex also tolerates an unpadded "GMT+2" in case
 * of ICU data variance across environments. */
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
 * The offset is resolved via `@admitto/shared`'s `zonedWallClockToUtcIso` - the correct instant
 * for `hhmm` on that day in `timeZone`, not a "treat the digits as UTC" proxy. That shortcut
 * looked close enough to land on the right side of a DST transition, but review (2026-08-15)
 * found it wrong for a same-day start/end pair straddling a transition in a zone with a
 * non-zero standard offset: an America/New_York event from 01:00 to 03:00 on 2026-03-08 (the US
 * spring-forward date) had both probes land on the pre-transition side, computing a 2-hour
 * duration for what is actually a 1-hour local span (2:00-3:00am doesn't exist that day).
 *
 * When `hhmm` itself falls inside a spring-forward gap (e.g. 02:30 that same day, which the
 * local clock skips straight over), `zonedWallClockToUtcIso` resolves to the nearest valid
 * instant instead - recombining that instant's offset with the original, nonexistent `hhmm`
 * digits would silently label a *different* instant (bot review, confirmed: 02:30 resolves to
 * 07:30Z, but the string "...T02:30:00-04:00" parses as 06:30Z). Detect that mismatch and emit
 * the resolved instant directly (a plain UTC ISO string) rather than a wrong local-digit one. */
function zonedDateTimeToIso(date: Date, hhmm: string | null, timeZone: string): string | undefined {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return undefined;
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const dayStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const correctInstant = new Date(zonedWallClockToUtcIso(dayStr, `${hhmm}:00.000`, timeZone));
  if (localWallClockReading(correctInstant, timeZone) !== hhmm) return correctInstant.toISOString();
  return `${dayStr}T${hhmm}:00${tzOffsetSuffix(correctInstant, timeZone)}`;
}

/** "HH:MM" wall-clock reading of `instant` in `timeZone` - used to detect whether
 * zonedDateTimeToIso's requested `hhmm` actually exists on that day (see above). */
function localWallClockReading(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour === "24" ? "00" : hour}:${minute}`;
}

/** PassCreator's top-level `relevantDate` ("Y-m-d H:i", no offset - the event's own local wall-clock
 * digits, matching the plain instant PassCreator's own docs example uses): controls when the pass
 * surfaces on the Lock Screen. Apple-only, always-on whenever the event has a start time - gated
 * on `walletAppleEnabled` alone so a Google-only event never sends it. Undefined when there's no
 * start time to anchor it to, rather than guessing one. */
function computeRelevantDate(event: {
  date: Date;
  eventHoursStart: string | null;
  walletAppleEnabled: boolean;
}): string | undefined {
  if (!event.walletAppleEnabled || !event.eventHoursStart) return undefined;
  const y = event.date.getUTCFullYear();
  const m = event.date.getUTCMonth();
  const d = event.date.getUTCDate();
  const dayStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return `${dayStr} ${event.eventHoursStart}`;
}

/** Admitto's `event_type` DB key -> Apple's PKEventType semantic-tag literal. Used only to
 * translate the value before it becomes the `event_type` WALLET_MAPPING_PLACEHOLDERS entry -
 * PassCreator itself never sees Admitto's own key, only the Apple-vocabulary string. */
const EVENT_TYPE_TO_APPLE: Record<string, string> = {
  generic: "PKEventTypeGeneric",
  live_performance: "PKEventTypeLivePerformance",
  movie: "PKEventTypeMovie",
  sports: "PKEventTypeSports",
  conference: "PKEventTypeConference",
  convention: "PKEventTypeConvention",
  workshop: "PKEventTypeWorkshop",
  social_gathering: "PKEventTypeSocialGathering",
};

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
  // An overnight event (end time earlier than start time) closes on the calendar day *after*
  // event.date - venue_close_time plays the same role event_hours_end used to for the removed
  // eventEndDate semantic tag, and needs the same +24h anchor or it resolves to an instant
  // before the event even starts. The other 6 access-point times (doors/gates/box office/
  // parking/venue open, fan zone) are all pre-event and stay anchored to event.date itself.
  const isOvernight = !!event.eventHoursStart && !!event.eventHoursEnd && event.eventHoursEnd < event.eventHoursStart;
  const venueCloseDateBase = isOvernight ? new Date(event.date.getTime() + 24 * 60 * 60 * 1000) : event.date;
  return {
    attendeeName: attendee.name,
    attendeeFirstNameLabel: attendee.first_name || undefined,
    attendeeLastNameLabel: attendee.last_name || undefined,
    attendeeEmailLabel: attendee.email || undefined,
    attendeeCompanyLabel: attendee.company || undefined,
    attendeeDepartmentLabel: attendee.department || undefined,
    eventNameLabel: event.title,
    eventDateLabel: formatDate(event.date, event.addressComponents?.country),
    eventDateShortLabel: formatDateShort(event.date, event.addressComponents?.country),
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
    relevantDate: computeRelevantDate(event),
    eventTypeLabel: event.eventType ? EVENT_TYPE_TO_APPLE[event.eventType] : undefined,
    venueRoomLabel: event.venueRoom || undefined,
    venueEntranceLabel: event.venueEntrance || undefined,
    venueEntranceDoorLabel: event.venueEntranceDoor || undefined,
    venueEntranceGateLabel: event.venueEntranceGate || undefined,
    venueEntrancePortalLabel: event.venueEntrancePortal || undefined,
    venuePhoneNumberLabel: event.venuePhoneNumber || undefined,
    venuePlaceIdLabel: event.venuePlaceId || undefined,
    venueOpenTimeLabel: zonedDateTimeToIso(event.date, event.venueOpenTime, event.timezone),
    venueCloseTimeLabel: zonedDateTimeToIso(venueCloseDateBase, event.venueCloseTime, event.timezone),
    doorsOpenTimeLabel: zonedDateTimeToIso(event.date, event.doorsOpenTime, event.timezone),
    gatesOpenTimeLabel: zonedDateTimeToIso(event.date, event.gatesOpenTime, event.timezone),
    boxOfficeOpenTimeLabel: zonedDateTimeToIso(event.date, event.boxOfficeOpenTime, event.timezone),
    parkingLotsOpenTimeLabel: zonedDateTimeToIso(event.date, event.parkingLotsOpenTime, event.timezone),
    fanZoneOpenTimeLabel: zonedDateTimeToIso(event.date, event.fanZoneOpenTime, event.timezone),
  };
}
