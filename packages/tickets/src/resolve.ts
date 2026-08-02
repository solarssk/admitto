import type { Prisma, PrismaClient } from "@admitto/db";
// Subpath import, not the package root - the root barrel also re-exports compileTemplate, which
// pulls in the full `mjml` compiler (and its own large dependency tree). @admitto/tickets is
// bundled into the admin SPA, so importing from the root here would ship all of that unused MJML
// code to the browser - confirmed by an actual build: the admin bundle went from ~828 kB (234 kB
// gzip) to 5.5 MB (1.6 MB gzip) before this fix (audytor review, #503).
import { resolveBrandingFromEvent } from "@admitto/mail-templates/branding";
import { hashToken } from "./hash.js";
import { extractTokenFromUrl, looksLikeInternalToken } from "./url.js";
import type { ResolveTicketContext, ResolvedTicket } from "./types.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

type TicketLogoSource = {
  logo_url: string | null;
  header_image_url: string | null;
  organization: { logo_url: string | null; header_image_url: string | null };
};

/** Best-effort read of Location-tab `address_components` JSON without pulling `@admitto/location`
 * into this package (tickets is also bundled into the admin SPA). */
export function parseTicketAddressComponents(
  value: unknown,
): ResolvedTicket["event"]["addressComponents"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const read = (key: string): string | null => {
    const v = raw[key];
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed || null;
  };
  const components = {
    object_name: read("object_name"),
    street: read("street"),
    postcode: read("postcode"),
    city: read("city"),
    region: read("region"),
    country: read("country"),
  };
  if (!Object.values(components).some(Boolean)) return null;
  return components;
}

/** Event logo, falling back to the organization's when the event has none set - null when
 * neither is configured (#419). Shared by both public ticket page resolvers (token-based
 * resolveTicket below, and apps/web's public_ref-based findAttendeeForEventRoute) so they can't
 * independently drift on the fallback order. */
export function resolveTicketLogoUrl(event: TicketLogoSource): string | null {
  return resolveBrandingFromEvent(event).logo_url || null;
}

/**
 * Resolve a scanned value to an attendee + event record.
 *
 * Resolution order:
 *   1. Full ticket URL  → extract token → sha256 → lookup by token_hash  (Mode A)
 *   2. Raw internal token (base64url ~43 chars) → sha256 → lookup by token_hash  (Mode A)
 *   3. Exact match on qr_payload  (Mode B, requires eventId context)
 *   4. Exact match on external_uuid  (Mode B, requires eventId context)
 *
 * Returns null when no attendee is found.
 * The same resolver is reused by the check-in flow in Step 3.
 */
export async function resolveTicket(
  scanned: string,
  prisma: DbClient,
  context: ResolveTicketContext = {},
): Promise<ResolvedTicket | null> {
  // Mode A — URL or raw token
  const rawToken = extractTokenFromUrl(scanned) ?? (looksLikeInternalToken(scanned) ? scanned : null);

  if (rawToken) {
    const hash = hashToken(rawToken);
    const row = context.eventId
      ? await prisma.attendee.findFirst({
          where: { token_hash: hash, event_id: context.eventId },
          include: { event: { include: { organization: true, location_details: true } } },
        })
      : await prisma.attendee.findUnique({
          where: { token_hash: hash },
          include: { event: { include: { organization: true, location_details: true } } },
        });
    if (row) return toResolved(row, "internal");
  }

  // Mode B lookups are event-scoped only. Agency identifiers are not assumed to be globally unique.
  if (!context.eventId) return null;

  // Mode B — agency qr_payload. Ambiguous matches are treated as unresolved.
  const byQr = await prisma.attendee.findMany({
    where: { event_id: context.eventId, qr_payload: scanned },
    include: { event: { include: { organization: true, location_details: true } } },
    take: 2,
  });
  if (byQr.length > 1) return null;

  // Mode B — agency external_uuid
  const byUuid = await prisma.attendee.findFirst({
    where: { event_id: context.eventId, external_uuid: scanned },
    include: { event: { include: { organization: true, location_details: true } } },
  });

  if (byQr[0] && byUuid && byQr[0].id !== byUuid.id) {
    return null;
  }

  if (byQr[0]) return toResolved(byQr[0], "agency");
  if (byUuid) return toResolved(byUuid, "agency");

  return null;
}

/** Exported so apps/web's public_ref-based findAttendeeForEventRoute (a second ResolvedTicket
 * producer, outside this module) can build the exact same shape instead of maintaining its own
 * copy of this mapping (CodeRabbit review). */
type LocationDetailsForTicket = {
  venue_name: string | null;
  formatted_address: string | null;
  address_components: unknown;
  latitude: number | null;
  longitude: number | null;
  map_zoom: number;
  directions_text: string | null;
  accessibility_text: string | null;
} | null;

export function toResolved(
  row: {
    id: string; event_id: string; email: string; name: string; status: string;
    token_hash: string | null; qr_payload: string | null; external_uuid: string | null;
    ticket_type: string | null;
    event: {
      id: string; title: string; date: Date;
      location_details?: LocationDetailsForTicket;
      logo_url: string | null; header_image_url: string | null;
      organization: { logo_url: string | null; header_image_url: string | null };
    };
  },
  mode: ResolvedTicket["mode"],
): ResolvedTicket {
  const loc = row.event.location_details;
  return {
    mode,
    attendee: {
      id: row.id,
      event_id: row.event_id,
      email: row.email,
      name: row.name,
      status: row.status,
      token_hash: row.token_hash,
      qr_payload: row.qr_payload,
      external_uuid: row.external_uuid,
      ticket_type: row.ticket_type,
    },
    event: {
      id: row.event.id,
      title: row.event.title,
      date: row.event.date,
      location: loc?.venue_name ?? null,
      logoUrl: resolveTicketLogoUrl(row.event),
      formattedAddress: loc?.formatted_address ?? null,
      addressComponents: loc ? parseTicketAddressComponents(loc.address_components) : null,
      latitude: loc?.latitude ?? null,
      longitude: loc?.longitude ?? null,
      mapZoom: loc ? loc.map_zoom : null,
      directionsText: loc?.directions_text ?? null,
      accessibilityText: loc?.accessibility_text ?? null,
    },
  };
}
