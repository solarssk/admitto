/**
 * Deployment-level map tile config for the Location tab's Leaflet map (and any future map
 * view — Phase 2 ticket/list reuse). Any authenticated staff member with admin panel access
 * can read it; it carries no per-event or per-organization data, only operator-configured
 * env vars (see `../maps/config.ts`).
 */
import type { Context } from "hono";
import { resolveMapTileConfig } from "../maps/config.js";

/** GET /api/admin/maps/config */
export function handleGetMapsConfig(c: Context): Response {
  const config = resolveMapTileConfig();
  return c.json({
    enabled: config.enabled,
    tile_url: config.tileUrl,
    attribution: config.attribution,
    max_zoom: config.maxZoom,
  });
}
