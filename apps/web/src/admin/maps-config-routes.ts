/**
 * Deployment-level map tile config for the Location tab's Leaflet map (and any future map
 * view — Phase 2 ticket/list reuse). Any authenticated staff member with admin panel access
 * can read it; it carries no per-event or per-organization data beyond a boolean hint that
 * Support contact is configured (for the Nominatim usage-policy notice), only
 * operator-configured env vars otherwise (see `../maps/config.ts`).
 */
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { resolveMapTileConfig } from "../maps/config.js";
import { isGeocodingContactConfigured } from "../maps/user-agent.js";

/** GET /api/admin/maps/config */
export async function handleGetMapsConfig(c: Context, db: PrismaClient): Promise<Response> {
  const config = resolveMapTileConfig();
  const contactConfigured = await isGeocodingContactConfigured(db);
  return c.json({
    enabled: config.enabled,
    tile_url: config.tileUrl,
    attribution: config.attribution,
    max_zoom: config.maxZoom,
    contact_configured: contactConfigured,
  });
}
