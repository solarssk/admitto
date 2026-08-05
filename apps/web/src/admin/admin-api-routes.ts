import type { Context } from "hono";
import { Prisma } from "@admitto/db";
import type { PrismaClient } from "@admitto/db";
import { z } from "zod";
import { canManageInstance, listAdminEvents } from "@admitto/auth";
import { ensureBadgeEventItem, ensureStandardTicketType, writeAdminAuditLog } from "@admitto/tickets";
import { emitSystemLog, recordSystemLog } from "@admitto/shared/system-log";
import { assertCoordinatePairing, buildEventStaticMapPath, LOCATION_LIMITS, LocationValidationError } from "@admitto/location";
import { resolveMapTileConfig } from "../maps/config.js";
import { plainMapAttribution } from "../maps/static-map.js";
import { createWeatherServiceFromDb } from "../weather/weather-org-settings.js";
import type { WeatherSummaryDto } from "../weather/types.js";
import {
  adminAuditFromContext,
  countAttendeesByEvent,
  isValidCalendarDate,
  parseEventDateInput,
  resolveActorEmailForLog,
  resolveUserDisplayMap,
  type UserDisplayRow,
} from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";
import { timezoneField } from "./timezone.js";

const slugField = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_-]+$/, "Slug: lowercase letters, numbers, hyphens, and underscores only");

const dateOnlyField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => isValidCalendarDate(value), "Invalid date");

// Location is a single free-typed field in the UI (styled like the check-in name/email
// suggester): `venue_name` is always whatever the admin typed or picked, while
// `formatted_address`/`latitude`/`longitude`/`geocoding_provider` are only present together
// when a geocoding search result was actually selected — plain typed text carries just
// `venue_name`. Ranges/lengths mirror `@admitto/location`'s `EventLocationInput` so the
// create-event form and the Location tab agree on limits.
const createEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: slugField,
  date: z.union([z.string().datetime({ offset: true }), dateOnlyField]),
  timezone: timezoneField,
  venue_name: z.string().trim().max(LOCATION_LIMITS.VENUE_NAME_MAX_LENGTH).optional(),
  formatted_address: z.string().trim().max(LOCATION_LIMITS.ADDRESS_MAX_LENGTH).optional(),
  latitude: z.number().min(LOCATION_LIMITS.LATITUDE_MIN).max(LOCATION_LIMITS.LATITUDE_MAX).optional(),
  longitude: z.number().min(LOCATION_LIMITS.LONGITUDE_MIN).max(LOCATION_LIMITS.LONGITUDE_MAX).optional(),
  geocoding_provider: z.string().trim().max(50).optional(),
});

type EventJsonRow = {
  id: string;
  title: string;
  slug: string;
  date: Date;
  timezone: string;
  location: string | null;
  has_coordinates?: boolean;
  map_latitude?: number | null;
  map_longitude?: number | null;
  map_zoom?: number | null;
  organization_id: string;
  archived_at: Date | null;
  created_at: Date;
  created_by_user_id: string | null;
  created_by_timezone: string | null;
  archived_by_user_id: string | null;
  archived_by_timezone: string | null;
};

/** List-card `/m/` path when maps are enabled and the event has a complete pin; otherwise null. */
export function eventListMapPreviewPath(event: {
  id: string;
  map_latitude?: number | null;
  map_longitude?: number | null;
  map_zoom?: number | null;
}): string | null {
  if (!resolveMapTileConfig().enabled) return null;
  const lat = event.map_latitude;
  const lng = event.map_longitude;
  if (lat == null || lng == null) return null;
  return `${buildEventStaticMapPath(event.id, {
    latitude: lat,
    longitude: lng,
    zoom: event.map_zoom,
  })}&context=list`;
}

/** Map an event row to the admin/check-in picker JSON shape. `userDisplayMap` resolves
 * created_by_user_id/archived_by_user_id to a display name/email - omitted (both null) when the
 * caller has no map to resolve against (e.g. the check-in picker doesn't need this). */
export function serializeEventDto(
  event: EventJsonRow,
  count?: number,
  userDisplayMap?: Record<string, UserDisplayRow>,
) {
  const createdBy = event.created_by_user_id ? userDisplayMap?.[event.created_by_user_id] : undefined;
  const archivedBy = event.archived_by_user_id ? userDisplayMap?.[event.archived_by_user_id] : undefined;
  const mapPreviewPath = eventListMapPreviewPath(event);
  const mapAttribution = mapPreviewPath
    ? plainMapAttribution(resolveMapTileConfig().attribution) || null
    : null;
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    date: event.date.toISOString(),
    timezone: event.timezone,
    location: event.location,
    has_coordinates: event.has_coordinates === true,
    map_preview_path: mapPreviewPath,
    map_attribution: mapAttribution,
    organization_id: event.organization_id,
    archived_at: event.archived_at?.toISOString() ?? null,
    created_at: event.created_at.toISOString(),
    created_by_display_name: createdBy?.display_name ?? null,
    created_by_email: createdBy?.email ?? null,
    created_by_timezone: event.created_by_timezone,
    archived_by_display_name: archivedBy?.display_name ?? null,
    archived_by_email: archivedBy?.email ?? null,
    archived_by_timezone: event.archived_by_timezone,
    ...(count !== undefined ? { attendee_count: count } : {}),
  };
}

export type EventDtoJson = ReturnType<typeof serializeEventDto> & {
  weather?: WeatherSummaryDto | null;
};

/** Attach Open-Meteo day summaries (null omitted when weather disabled / no pin). */
export async function attachWeatherToEventDtos(
  db: PrismaClient,
  events: EventJsonRow[],
  dtos: EventDtoJson[],
): Promise<EventDtoJson[]> {
  if (events.length === 0) return dtos;
  const weather = await createWeatherServiceFromDb(db);
  if (!weather.enabled) return dtos;
  const summaries = await Promise.all(
    events.map((e) =>
      weather.summarize({
        latitude: e.map_latitude,
        longitude: e.map_longitude,
        date: e.date,
        timezone: e.timezone,
      }),
    ),
  );
  return dtos.map((dto, i) => {
    const summary = summaries[i];
    if (summary == null) return dto;
    return { ...dto, weather: summary };
  });
}

async function resolveCreateEventOrgId(
  db: PrismaClient,
  userId: string,
  isSuperadmin: boolean,
): Promise<string | Response> {
  if (isSuperadmin) {
    return resolveInstanceOrganizationId(db);
  }

  const adminRoles = await db.roleAssignment.findMany({
    where: { user_id: userId, role: "admin", scope_type: "organization" },
    select: { scope_id: true },
    orderBy: { scope_id: "asc" },
  });
  const orgIds = adminRoles
    .map((role) => role.scope_id)
    .filter((scopeId): scopeId is string => scopeId != null);

  if (orgIds.length === 0) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }
  if (orgIds.length > 1) {
    return new Response(
      JSON.stringify({
        error:
          "Multiple organization admin assignments. Organization selection is not supported yet.",
      }),
      { status: 422 },
    );
  }
  return orgIds[0]!;
}

/** GET /api/admin/events — admin picker (session gate applied upstream). Query: includeArchived=true. */
export async function handleGetAdminEvents(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  const includeArchived = c.req.query("includeArchived") === "true";
  const events = await listAdminEvents(db, auth.userId, { includeArchived });
  const countByEvent = await countAttendeesByEvent(db, events.map((e) => e.id));
  const actorIds = events.flatMap((e) => [e.created_by_user_id, e.archived_by_user_id].filter((id): id is string => !!id));
  const userDisplayMap = await resolveUserDisplayMap(db, actorIds);

  const dtos = events.map((e) => serializeEventDto(e, countByEvent.get(e.id) ?? 0, userDisplayMap));
  const withWeather = await attachWeatherToEventDtos(db, events, dtos);
  return c.json({ events: withWeather });
}

/** POST /api/admin/events — create event (superadmin or org admin). */
export async function handleCreateEvent(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "validation_failed";
    return c.json({ error: message }, 400);
  }

  const { title, slug, date, timezone, venue_name, formatted_address, latitude, longitude, geocoding_provider } =
    parsed.data;
  const dateValue = parseEventDateInput(date);

  try {
    assertCoordinatePairing(latitude ?? null, longitude ?? null);
  } catch (err) {
    if (err instanceof LocationValidationError) return c.json({ error: err.message }, 400);
    throw err;
  }

  const isSuperadmin = await canManageInstance(db, auth.userId);
  const orgIdOrRes = await resolveCreateEventOrgId(db, auth.userId, isSuperadmin);
  if (orgIdOrRes instanceof Response) return orgIdOrRes;
  const orgId = orgIdOrRes;

  const existing = await db.event.findUnique({ where: { slug } });
  if (existing) {
    return c.json({ code: "slug_taken", error: "Slug is already in use." }, 409);
  }

  const audit = adminAuditFromContext(c);
  const actorUserId = auth.userId;
  const trimmedVenueName = venue_name?.trim() || null;
  const trimmedAddress = formatted_address?.trim() || null;
  const hasLocation = trimmedVenueName !== null || trimmedAddress !== null || latitude !== undefined;

  try {
    const event = await db.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          title,
          slug,
          date: dateValue,
          timezone,
          organization_id: orgId,
          created_by_user_id: actorUserId,
          created_by_timezone: audit.timezone,
        },
      });

      // Location is optional at creation — the Location tab (Event Settings) is where an
      // admin can add/edit it after the fact, so we only write a row when the form actually
      // carried something.
      if (hasLocation) {
        await tx.eventLocation.create({
          data: {
            event_id: created.id,
            venue_name: trimmedVenueName,
            formatted_address: trimmedAddress,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
            ...(latitude !== undefined
              ? { geocoding_provider: geocoding_provider?.trim() || null, geocoded_at: new Date() }
              : {}),
          },
        });
      }

      // Seed the "badge" item eagerly so Requirements lists it right after
      // create — the badge_at_entry ops-config toggle defaults to on and is
      // otherwise a no-op with no matching item (#367, #368 keep all other
      // items empty by default; badge is the one exception, see event-items.ts).
      await ensureBadgeEventItem(created.id, tx);
      // Seed the default "Standard" ticket type so the catalog isn't empty from the start
      // (batch 04 / #351) — admins add VIP/others via Event Settings -> Ticket types.
      await ensureStandardTicketType(created.id, tx);

      await writeAdminAuditLog(tx, {
        organizationId: orgId,
        actorUserId,
        sessionId: audit.sessionId,
        ip: audit.ip,
        timezone: audit.timezone,
        actionType: "event_created",
        metadata: { eventId: created.id, title: created.title, slug: created.slug },
      });

      return {
        ...created,
        location: trimmedVenueName,
        has_coordinates: latitude != null && longitude != null,
        map_latitude: latitude ?? null,
        map_longitude: longitude ?? null,
        map_zoom: latitude != null && longitude != null ? 15 : null,
      };
    });

    emitSystemLog("admin", "info", "event_created", {
      eventId: event.id,
      orgId,
      actorUserId,
      actorEmail: await resolveActorEmailForLog(db, actorUserId),
    });

    return c.json({ event: serializeEventDto(event) }, 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return c.json({ code: "slug_taken", error: "Slug is already in use." }, 409);
    }
    console.error("[audit] event_created transaction failed", err);
    recordSystemLog({
      level: "error",
      source: "admin",
      message: "event_created_failed",
      fields: { orgId, actorUserId, errorKind: "transaction" },
    });
    return c.json({ code: "audit_failed" }, 500);
  }
}
