/**
 * Geocoding search / reverse / timezone for the Location tab — not event-scoped (no `eventId`
 * in the URL): any staff member who can reach the admin panel may look up an address while
 * editing whichever event they have access to. Authorization is `staffAdminGate` alone
 * (mounted in app.ts), same as the admin panel entry point itself.
 */
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { z } from "zod";
import { GeocodingProviderError } from "../maps/nominatim-provider.js";
import type { GeocodingService } from "../maps/geocoding-service.js";
import { timezoneFromCoordinates } from "../maps/timezone-from-coordinates.js";
import { isGeocodingContactConfigured } from "../maps/user-agent.js";

const MAX_QUERY_LENGTH = 300;

const searchBodySchema = z
  .object({
    query: z.string().trim().min(2).max(MAX_QUERY_LENGTH),
  })
  .strict();

const reverseBodySchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();

const timezoneBodySchema = reverseBodySchema;

async function mapProviderError(err: unknown): Promise<Response | null> {
  if (err instanceof GeocodingProviderError) {
    const status = err.kind === "timeout" ? 503 : 502;
    return Response.json({ error: "geocoding_unavailable" }, { status });
  }
  return null;
}

/** POST /api/admin/geocoding/search */
export async function handlePostGeocodingSearch(
  c: Context,
  db: PrismaClient,
  service: GeocodingService,
): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = searchBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  try {
    const [results, contactConfigured] = await Promise.all([
      service.search(parsed.data.query),
      isGeocodingContactConfigured(db),
    ]);
    return c.json({ results, contact_configured: contactConfigured });
  } catch (err) {
    const mapped = await mapProviderError(err);
    if (mapped) return mapped;
    throw err;
  }
}

/** POST /api/admin/geocoding/reverse — resolve an address for a map pin click/drag. */
export async function handlePostGeocodingReverse(
  c: Context,
  db: PrismaClient,
  service: GeocodingService,
): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = reverseBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  try {
    const [result, contactConfigured] = await Promise.all([
      service.reverse(parsed.data.latitude, parsed.data.longitude),
      isGeocodingContactConfigured(db),
    ]);
    return c.json({ result, contact_configured: contactConfigured });
  } catch (err) {
    const mapped = await mapProviderError(err);
    if (mapped) return mapped;
    throw err;
  }
}

/** POST /api/admin/geocoding/timezone — IANA zone for a pin (offline geo-tz on the server). */
export async function handlePostGeocodingTimezone(c: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = timezoneBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const timezone = timezoneFromCoordinates(parsed.data.latitude, parsed.data.longitude);
  return c.json({ timezone });
}
