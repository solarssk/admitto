/**
 * Geocoding search for the Location tab's "Find on map" — not event-scoped (no `eventId` in
 * the URL): any staff member who can reach the admin panel may look up an address while
 * editing whichever event they have access to. Authorization is `staffAdminGate` alone
 * (mounted in app.ts), same as the admin panel entry point itself.
 */
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { z } from "zod";
import { GeocodingProviderError } from "../maps/nominatim-provider.js";
import type { GeocodingService } from "../maps/geocoding-service.js";
import { isGeocodingContactConfigured } from "../maps/user-agent.js";

const MAX_QUERY_LENGTH = 300;

const searchBodySchema = z
  .object({
    query: z.string().trim().min(2).max(MAX_QUERY_LENGTH),
  })
  .strict();

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
    if (err instanceof GeocodingProviderError) {
      const status = err.kind === "timeout" ? 503 : 502;
      return c.json({ error: "geocoding_unavailable" }, status);
    }
    throw err;
  }
}
