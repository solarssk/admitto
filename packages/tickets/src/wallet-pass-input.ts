import type { PrismaClient } from "@admitto/db";
import type { WalletPassInput, WalletPassSemantics } from "@admitto/wallet";
import { isMapReady, resolveAppleMapsUrl, resolveGoogleMapsUrl } from "@admitto/location";
import { loadEventTicketTypes } from "./ticket-types.js";
import type { resolveTicket } from "./resolve.js";

type ResolvedTicket = NonNullable<Awaited<ReturnType<typeof resolveTicket>>>;

/** "long month" en-GB style, e.g. "24 September 2026" - shared by the ticket page and wallet
 * pass content (now rendered from two different processes, apps/web and the apps/cli worker) so
 * both show the event date identically. Explicit UTC (bot review) rather than relying on the
 * two processes sharing a host TZ - parseEventDateInput already anchors a date-only input at
 * noon UTC specifically so this never crosses a day boundary for any real deployment, but pinning
 * it here too means that stays true even if that anchoring ever changes. */
export function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

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

/** "HH:MM-HH:MM" for the pass, or undefined when either bound is unset (independently optional). */
function formatEventHours(event: { eventHoursStart: string | null; eventHoursEnd: string | null }): string | undefined {
  if (!event.eventHoursStart || !event.eventHoursEnd) return undefined;
  return `${event.eventHoursStart}-${event.eventHoursEnd}`;
}

/** UTC offset suffix ("+02:00" / "-05:00" / "Z") for `timeZone` at `date` - `date` only needs to
 * land on the right side of any DST transition for that zone, not be the precise instant, since
 * `event.date` is itself a display-only calendar day (noon UTC, see formatDate above) rather than
 * a real event instant. Node/V8's `longOffset` gives "GMT+02:00" (or bare "GMT" for UTC); the
 * regex also tolerates an unpadded "GMT+2" in case of ICU data variance across environments. */
function tzOffsetSuffix(date: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(date)
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
 * worse for Siri Suggestions than omitting the field entirely. */
function zonedDateTimeToIso(date: Date, hhmm: string | null, timeZone: string): string | undefined {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return undefined;
  const dayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return `${dayStr}T${hhmm}:00${tzOffsetSuffix(date, timeZone)}`;
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
  const duration =
    event.eventHoursStart && event.eventHoursEnd
      ? minutesBetween(event.eventHoursStart, event.eventHoursEnd) * 60
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

/** Whole minutes between two "HH:MM" strings, wrapping past midnight (end before start means an
 * overnight event) - deliberately timezone-agnostic, since a plain duration only needs the
 * difference between two wall-clock times in the same zone, not an absolute instant. */
function minutesBetween(startHhmm: string, endHhmm: string): number {
  const [startH = 0, startM = 0] = startHhmm.split(":").map(Number);
  const [endH = 0, endM = 0] = endHhmm.split(":").map(Number);
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;
  return end >= start ? end - start : end + 24 * 60 - start;
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
    eventDateLabel: formatDate(event.date),
    eventHoursLabel: formatEventHours(event),
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
