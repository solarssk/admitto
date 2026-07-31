/**
 * Event Settings "Location" tab — full address, map coordinates/zoom, and directions/
 * accessibility notes for an event's venue. Persisted in a separate 1:1 `EventLocation`
 * table (see schema.prisma) — `Event.location` remains the short display name shown on
 * the event list/card and in ticket emails, unrelated to this richer record.
 *
 * Structural validation (types, unknown-key rejection) happens here via Zod; the actual
 * business rules (length limits, lat/lng/zoom ranges, "both coordinates or neither") live
 * once in `@admitto/location` so the admin API and any future caller share one source of
 * truth instead of duplicating range checks.
 */
import type { Context } from "hono";
import { Prisma, type PrismaClient } from "@admitto/db";
import { writeAdminAuditLog } from "@admitto/tickets";
import {
  assertCoordinatePairing,
  LocationValidationError,
  normalizeEventLocationInput,
  type EventLocationDto,
} from "@admitto/location";
import { z } from "zod";
import { adminAuditFromContext, assertEventManageAccess, requireEventId } from "./admin-helpers.js";

const putLocationBodySchema = z
  .object({
    venue_name: z.string().nullish(),
    formatted_address: z.string().nullish(),
    latitude: z.number().nullish(),
    longitude: z.number().nullish(),
    map_zoom: z.number().nullish(),
    directions_text: z.string().nullish(),
    accessibility_text: z.string().nullish(),
    // API-layer only — not part of `@admitto/location`'s EventLocationInput, since it isn't a
    // user-editable field with its own validation rules. It only ever rides along with a
    // latitude/longitude change (see the geocoding provenance logic below).
    geocoding_provider: z.string().nullish(),
  })
  .strict();

type EventLocationRow = {
  venue_name: string | null;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  map_zoom: number;
  directions_text: string | null;
  accessibility_text: string | null;
  geocoding_provider: string | null;
  geocoded_at: Date | null;
};

/** Stable empty shape returned by GET when no `EventLocation` row exists yet — the tab
 * always has something to render instead of branching on a 404. */
const EMPTY_LOCATION_DTO: EventLocationDto = {
  venue_name: null,
  formatted_address: null,
  latitude: null,
  longitude: null,
  map_zoom: 15,
  directions_text: null,
  accessibility_text: null,
  geocoding_provider: null,
  geocoded_at: null,
};

function serializeLocation(row: EventLocationRow | null): EventLocationDto {
  if (!row) return EMPTY_LOCATION_DTO;
  return {
    venue_name: row.venue_name,
    formatted_address: row.formatted_address,
    latitude: row.latitude,
    longitude: row.longitude,
    map_zoom: row.map_zoom,
    directions_text: row.directions_text,
    accessibility_text: row.accessibility_text,
    geocoding_provider: row.geocoding_provider,
    geocoded_at: row.geocoded_at ? row.geocoded_at.toISOString() : null,
  };
}

/** GET /api/admin/events/:eventId/location */
export async function handleGetEventLocation(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) return c.json({ error: "not_found" }, 404);

  const location = await db.eventLocation.findUnique({ where: { event_id: eventId } });
  return c.json(serializeLocation(location));
}

/**
 * PUT /api/admin/events/:eventId/location — mounted behind `guardArchivedEvent` in app.ts,
 * which already runs `assertEventManageAccess` and the archived-event check before this
 * handler is invoked.
 *
 * Partial-update semantics despite the PUT verb (same convention as mail settings): an
 * omitted key leaves that field unchanged, an explicit `null` (or empty string for text
 * fields) clears it.
 */
export async function handlePutEventLocation(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = putLocationBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  let patch: ReturnType<typeof normalizeEventLocationInput>;
  try {
    patch = normalizeEventLocationInput(parsed.data);
  } catch (err) {
    if (err instanceof LocationValidationError) return c.json({ error: err.message }, 400);
    throw err;
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const event = await db.event.findUnique({ where: { id: eventId }, select: { organization_id: true } });
  if (!event) return c.json({ error: "not_found" }, 404);

  const existing = await db.eventLocation.findUnique({ where: { event_id: eventId } });
  const mergedLatitude = patch.latitude !== undefined ? patch.latitude : (existing?.latitude ?? null);
  const mergedLongitude = patch.longitude !== undefined ? patch.longitude : (existing?.longitude ?? null);

  try {
    assertCoordinatePairing(mergedLatitude, mergedLongitude);
  } catch (err) {
    if (err instanceof LocationValidationError) return c.json({ error: err.message }, 400);
    throw err;
  }

  // Geocoding provenance: a coordinate change made by picking a search result carries a
  // `geocoding_provider` (e.g. "nominatim") and is stamped `geocoded_at: now()`. A coordinate
  // change with no provider — a dragged pin, a manually typed lat/lng, or a "clear location" —
  // means the previous provenance no longer describes these coordinates, so both are reset to
  // null. Leaving lat/lng untouched leaves provenance untouched too.
  const coordinatesInPatch = patch.latitude !== undefined || patch.longitude !== undefined;
  const rawProvider = parsed.data.geocoding_provider?.trim();
  const geocodingPatch = coordinatesInPatch
    ? rawProvider
      ? { geocoding_provider: rawProvider, geocoded_at: new Date() }
      : { geocoding_provider: null, geocoded_at: null }
    : {};

  const changedFields = [...Object.keys(patch), ...(coordinatesInPatch ? ["geocoding_provider"] : [])];
  const audit = adminAuditFromContext(c);
  const actorUserId = c.get("auth").userId;

  try {
    // No advisory lock here (unlike lockEventForMailSettingsWrite for MailSettings):
    // EventLocation has a real FK with onDelete: Cascade, so a concurrent permanent event
    // delete either finishes first (the upsert below then fails its FK check, caught and
    // mapped to 404) or runs after (Postgres cascades the delete for us). Two admins
    // racing a PUT against the same coordinate pair is a narrow, accepted MVP race — same
    // spirit as `assertEventNotArchived`'s check-then-write gap.
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.eventLocation.upsert({
        where: { event_id: eventId },
        create: {
          event_id: eventId,
          venue_name: patch.venue_name ?? null,
          formatted_address: patch.formatted_address ?? null,
          latitude: mergedLatitude,
          longitude: mergedLongitude,
          ...(patch.map_zoom !== undefined && { map_zoom: patch.map_zoom }),
          directions_text: patch.directions_text ?? null,
          accessibility_text: patch.accessibility_text ?? null,
          ...geocodingPatch,
        },
        update: {
          ...(patch.venue_name !== undefined && { venue_name: patch.venue_name }),
          ...(patch.formatted_address !== undefined && { formatted_address: patch.formatted_address }),
          ...(patch.latitude !== undefined && { latitude: patch.latitude }),
          ...(patch.longitude !== undefined && { longitude: patch.longitude }),
          ...(patch.map_zoom !== undefined && { map_zoom: patch.map_zoom }),
          ...(patch.directions_text !== undefined && { directions_text: patch.directions_text }),
          ...(patch.accessibility_text !== undefined && { accessibility_text: patch.accessibility_text }),
          ...geocodingPatch,
        },
      });

      await writeAdminAuditLog(tx, {
        organizationId: event.organization_id,
        actorUserId,
        sessionId: audit.sessionId,
        ip: audit.ip,
        timezone: audit.timezone,
        actionType: "event_location_updated",
        metadata: { eventId, fields: changedFields },
      });

      return row;
    });

    return c.json(serializeLocation(updated));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return c.json({ error: "not_found" }, 404);
    }
    throw err;
  }
}
