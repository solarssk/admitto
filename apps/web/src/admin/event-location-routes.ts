/**
 * Event Settings "Location" tab — full address, map coordinates/zoom, and directions/
 * accessibility notes for an event's venue. Persisted in a separate 1:1 `EventLocation`
 * table (see schema.prisma). `venue_name` on that row is the short display name shown on
 * the event list/card and in ticket emails; the former `Event.location` column is gone.
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
  LOCATION_LIMITS,
  LocationValidationError,
  normalizeEventLocationInput,
  parseStoredAddressComponents,
  type AddressComponents,
  type EventLocationDto,
  type EventLocationInput,
} from "@admitto/location";
import { recordSystemLog } from "@admitto/shared/system-log";
import { z } from "zod";
import { adminAuditFromContext, assertEventManageAccess, requireEventId } from "./admin-helpers.js";
import { enqueueEventWideWalletPushJob } from "./wallet-push-routes.js";

const addressComponentsSchema = z
  .object({
    object_name: z.string().nullable().optional(),
    street: z.string().nullable().optional(),
    postcode: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    region: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
  })
  .strict()
  .nullable();

const putLocationBodySchema = z
  .object({
    venue_name: z.string().nullish(),
    formatted_address: z.string().nullish(),
    latitude: z.number().nullish(),
    longitude: z.number().nullish(),
    map_zoom: z.number().nullish(),
    directions_text: z.string().nullish(),
    accessibility_text: z.string().nullish(),
    address_components: addressComponentsSchema.optional(),
    google_maps_url_override: z.string().nullish(),
    apple_maps_url_override: z.string().nullish(),
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
  address_components: Prisma.JsonValue | null;
  google_maps_url_override: string | null;
  apple_maps_url_override: string | null;
};

/** Stable empty shape returned by GET when no `EventLocation` row exists yet — the tab
 * always has something to render instead of branching on a 404. */
const EMPTY_LOCATION_DTO: EventLocationDto = {
  venue_name: null,
  formatted_address: null,
  latitude: null,
  longitude: null,
  map_zoom: LOCATION_LIMITS.DEFAULT_ZOOM,
  directions_text: null,
  accessibility_text: null,
  geocoding_provider: null,
  geocoded_at: null,
  address_components: null,
  google_maps_url_override: null,
  apple_maps_url_override: null,
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
    address_components: parseStoredAddressComponents(row.address_components),
    google_maps_url_override: row.google_maps_url_override,
    apple_maps_url_override: row.apple_maps_url_override,
  };
}

function componentsToJson(
  components: AddressComponents | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (components === undefined) return undefined;
  if (components === null) return Prisma.JsonNull;
  // AddressComponents has no index signature; spread to a plain record for Prisma JSON input.
  return { ...components } as Record<string, string | null> as Prisma.InputJsonValue;
}

type LocationPatch = ReturnType<typeof normalizeEventLocationInput>;

type GeocodingProvenancePatch =
  | { geocoding_provider: string; geocoded_at: Date }
  | { geocoding_provider: null; geocoded_at: null }
  | Record<string, never>;

/** Stamp or clear geocoding provenance.
 * - Coordinate change + non-empty provider → stamp; coordinate change without → clear.
 * - Explicit non-empty provider without a coordinate change → stamp (re-select same pin / restore Verified).
 * - Explicit `null` without a coordinate change → clear (free-text venue rename).
 * - Omitted provider without a coordinate change → leave untouched.
 */
function geocodingProvenancePatch(
  coordinatesInPatch: boolean,
  rawProvider: string | null | undefined,
): GeocodingProvenancePatch {
  if (coordinatesInPatch) {
    const provider = rawProvider?.trim();
    if (provider) {
      return { geocoding_provider: provider, geocoded_at: new Date() };
    }
    return { geocoding_provider: null, geocoded_at: null };
  }
  if (rawProvider === null) {
    return { geocoding_provider: null, geocoded_at: null };
  }
  if (typeof rawProvider === "string") {
    const provider = rawProvider.trim();
    if (provider) {
      return { geocoding_provider: provider, geocoded_at: new Date() };
    }
  }
  return {};
}

function mergedCoordinate(
  patchValue: number | null | undefined,
  existingValue: number | null | undefined,
): number | null {
  return patchValue !== undefined ? patchValue : (existingValue ?? null);
}

/** True when the merged pin differs from the stored row (stale Maps overrides must not survive). */
function coordinatesActuallyChanged(
  existing: { latitude: number | null; longitude: number | null } | null,
  mergedLatitude: number | null,
  mergedLongitude: number | null,
): boolean {
  if (!existing) return false;
  return existing.latitude !== mergedLatitude || existing.longitude !== mergedLongitude;
}

/**
 * Maps URL override columns for an update. Explicit patch wins; otherwise a real pin move
 * clears both overrides so Copy / tickets / mail do not keep linking to the previous venue.
 */
function mapsUrlOverrideUpdate(
  patch: LocationPatch,
  clearStaleOverrides: boolean,
): {
  google_maps_url_override?: string | null;
  apple_maps_url_override?: string | null;
} {
  const out: {
    google_maps_url_override?: string | null;
    apple_maps_url_override?: string | null;
  } = {};
  if (patch.google_maps_url_override !== undefined) {
    out.google_maps_url_override = patch.google_maps_url_override;
  } else if (clearStaleOverrides) {
    out.google_maps_url_override = null;
  }
  if (patch.apple_maps_url_override !== undefined) {
    out.apple_maps_url_override = patch.apple_maps_url_override;
  } else if (clearStaleOverrides) {
    out.apple_maps_url_override = null;
  }
  return out;
}

async function parseLocationPutBody(
  c: Context,
): Promise<{ patch: LocationPatch; geocodingProvider: string | null | undefined } | Response> {
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

  try {
    // Zod's partial nullish fields are wider than AddressComponents; normalizeEventLocationInput
    // re-validates address_components via normalizeAddressComponents(unknown).
    const patch = normalizeEventLocationInput(parsed.data as EventLocationInput);
    // Provider is API-only (not in normalizeEventLocationInput). A same-OSM re-select can send
    // only `geocoding_provider` — treat non-empty or explicit null as a valid patch.
    const providerRaw = parsed.data.geocoding_provider;
    const providerOnlyPatch =
      providerRaw === null || (typeof providerRaw === "string" && providerRaw.trim() !== "");
    if (Object.keys(patch).length === 0 && !providerOnlyPatch) {
      return c.json({ error: "validation_failed" }, 400);
    }
    return { patch, geocodingProvider: parsed.data.geocoding_provider };
  } catch (err) {
    if (err instanceof LocationValidationError) return c.json({ error: err.message }, 400);
    throw err;
  }
}

/** Location fields that appear in a wallet pass via buildWalletPassInput (packages/tickets/src/
 * wallet-pass-input.ts) - venue name, address, coordinates/maps links, directions/accessibility
 * notes. `map_zoom` and geocoding provenance (`geocoding_provider`/`geocoded_at`) are UI-only,
 * never read by the pass, so they're deliberately excluded. */
type WalletRelevantLocationSnapshot = {
  venue_name: string | null;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  directions_text: string | null;
  accessibility_text: string | null;
  address_components: Prisma.JsonValue | null;
  google_maps_url_override: string | null;
  apple_maps_url_override: string | null;
};

const EMPTY_WALLET_LOCATION_SNAPSHOT: WalletRelevantLocationSnapshot = {
  venue_name: null,
  formatted_address: null,
  latitude: null,
  longitude: null,
  directions_text: null,
  accessibility_text: null,
  address_components: null,
  google_maps_url_override: null,
  apple_maps_url_override: null,
};

/** True only when one of the wallet-relevant fields' *persisted* value actually differs from
 * before the save - comparing against the pre-write row (null when this is the event's first-ever
 * location save, treated as every field starting from EMPTY_WALLET_LOCATION_SNAPSHOT), not just
 * whether the patch touched the key (bot review, same reasoning as event-settings-routes.ts's own
 * walletRelevantEventFieldsChanged - an unconditional key-presence check would let a resubmit loop
 * repeatedly enqueue pushes for no real change once each prior job finishes). address_components
 * is JSON - compared by serialized value, not object identity, since Prisma returns a fresh
 * object on every read even when the stored content is byte-identical. */
function walletRelevantLocationFieldsChanged(
  existing: WalletRelevantLocationSnapshot | null,
  updated: WalletRelevantLocationSnapshot,
): boolean {
  const before = existing ?? EMPTY_WALLET_LOCATION_SNAPSHOT;
  return (
    before.venue_name !== updated.venue_name ||
    before.formatted_address !== updated.formatted_address ||
    before.latitude !== updated.latitude ||
    before.longitude !== updated.longitude ||
    before.directions_text !== updated.directions_text ||
    before.accessibility_text !== updated.accessibility_text ||
    before.google_maps_url_override !== updated.google_maps_url_override ||
    before.apple_maps_url_override !== updated.apple_maps_url_override ||
    JSON.stringify(before.address_components) !== JSON.stringify(updated.address_components)
  );
}

/** Best-effort: enqueues a wallet_push job to refresh every already-issued active wallet pass
 * whenever a save actually changes one of the wallet-relevant location fields - the location half
 * of the same gap event-settings-routes.ts's own pushWalletUpdatesBestEffort closes for the
 * event's basic fields (name/date/hours). Before this, buildWalletPassInput already read location
 * fields but nothing ever pushed a location change to an already-issued pass. */
async function pushWalletUpdatesBestEffort(
  db: PrismaClient,
  c: Context,
  eventId: string,
  existingLocation: WalletRelevantLocationSnapshot | null,
  updatedLocation: WalletRelevantLocationSnapshot,
  event: {
    organization_id: string;
    wallet_enabled: boolean;
    wallet_template_id: string | null;
    wallet_api_key_enc: string | null;
  },
): Promise<void> {
  if (!walletRelevantLocationFieldsChanged(existingLocation, updatedLocation)) return;
  if (!event.wallet_enabled || !event.wallet_template_id || !event.wallet_api_key_enc) return;

  await enqueueEventWideWalletPushJob(db, c, eventId, event.organization_id);
}

/** Wraps pushWalletUpdatesBestEffort above in its own try/catch + logging - factored out of
 * handlePutEventLocation (rather than inlined there) to keep that already-branchy handler under
 * SonarCloud's cognitive-complexity threshold; a nested try/catch inside it pushed it over. The
 * location write already committed by the time this runs, so a transient enqueue failure here
 * must not turn that success into a 500 (same reasoning as event-settings-routes.ts's own
 * basic-fields wallet push). */
async function pushWalletUpdatesBestEffortSafely(
  db: PrismaClient,
  c: Context,
  eventId: string,
  existingLocation: WalletRelevantLocationSnapshot | null,
  updatedLocation: WalletRelevantLocationSnapshot,
  event: {
    organization_id: string;
    wallet_enabled: boolean;
    wallet_template_id: string | null;
    wallet_api_key_enc: string | null;
  },
): Promise<void> {
  try {
    await pushWalletUpdatesBestEffort(db, c, eventId, existingLocation, updatedLocation, event);
  } catch (err) {
    console.error("wallet event-location push enqueue failed:", err);
    recordSystemLog({
      level: "error",
      source: "admin",
      message: "wallet_event_location_push_failed",
      fields: { eventId },
    });
  }
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

  const parsedOrRes = await parseLocationPutBody(c);
  if (parsedOrRes instanceof Response) return parsedOrRes;
  const { patch, geocodingProvider } = parsedOrRes;

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: {
      organization_id: true,
      wallet_enabled: true,
      wallet_template_id: true,
      wallet_api_key_enc: true,
    },
  });
  if (!event) return c.json({ error: "not_found" }, 404);

  const existing = await db.eventLocation.findUnique({ where: { event_id: eventId } });
  const mergedLatitude = mergedCoordinate(patch.latitude, existing?.latitude);
  const mergedLongitude = mergedCoordinate(patch.longitude, existing?.longitude);

  try {
    assertCoordinatePairing(mergedLatitude, mergedLongitude);
  } catch (err) {
    if (err instanceof LocationValidationError) return c.json({ error: err.message }, 400);
    throw err;
  }

  // Geocoding provenance: a search pick or successful reverse carries `geocoding_provider`
  // (e.g. "nominatim") and is stamped `geocoded_at: now()`, including when coordinates are
  // unchanged (re-selecting the same OSM hit to restore Verified). A coordinate change with no
  // provider - a dragged pin before reverse succeeds, or a "clear location" - resets both to
  // null. Explicit `geocoding_provider: null` without a coordinate change also clears
  // provenance (free-text venue rename). Omitting the field leaves provenance untouched.
  const coordinatesInPatch = patch.latitude !== undefined || patch.longitude !== undefined;
  const clearStaleMapsOverrides = coordinatesActuallyChanged(
    existing,
    mergedLatitude,
    mergedLongitude,
  );
  const geocodingPatch = geocodingProvenancePatch(coordinatesInPatch, geocodingProvider);
  const mapsOverridePatch = mapsUrlOverrideUpdate(patch, clearStaleMapsOverrides);

  const componentsJson = componentsToJson(patch.address_components);
  const changedFields = [
    ...Object.keys(patch),
    ...("geocoding_provider" in geocodingPatch ? ["geocoding_provider"] : []),
    ...(clearStaleMapsOverrides && patch.google_maps_url_override === undefined
      ? ["google_maps_url_override"]
      : []),
    ...(clearStaleMapsOverrides && patch.apple_maps_url_override === undefined
      ? ["apple_maps_url_override"]
      : []),
  ];
  const audit = adminAuditFromContext(c);
  const actorUserId = c.get("auth").userId;

  try {
    // No advisory lock here (unlike lockEventForScopedWrite for MailSettings/Templates):
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
          ...(componentsJson !== undefined && { address_components: componentsJson }),
          google_maps_url_override: patch.google_maps_url_override ?? null,
          apple_maps_url_override: patch.apple_maps_url_override ?? null,
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
          ...(componentsJson !== undefined && { address_components: componentsJson }),
          ...mapsOverridePatch,
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

    await pushWalletUpdatesBestEffortSafely(db, c, eventId, existing, updated, event);

    return c.json(serializeLocation(updated));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return c.json({ error: "not_found" }, 404);
    }
    throw err;
  }
}
