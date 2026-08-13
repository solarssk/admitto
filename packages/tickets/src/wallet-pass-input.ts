import type { PrismaClient } from "@admitto/db";
import type { WalletPassInput } from "@admitto/wallet";
import { isMapReady, resolveAppleMapsUrl, resolveGoogleMapsUrl } from "@admitto/location";
import { loadEventTicketTypes } from "./ticket-types.js";
import type { resolveTicket } from "./resolve.js";

type ResolvedTicket = NonNullable<Awaited<ReturnType<typeof resolveTicket>>>;

/** "long month" en-GB style, e.g. "24 September 2026" - shared by the ticket page and wallet
 * pass content so both show the event date identically. */
export function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
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
  };
}
