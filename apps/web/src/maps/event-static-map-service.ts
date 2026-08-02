/**
 * Resolve (or generate) a cached static map PNG for an event that has coordinates.
 */
import type { PrismaClient } from "@admitto/db";
import { isMapReady } from "@admitto/location";
import { resolveMapTileConfig } from "./config.js";
import {
  buildStaticMapCacheKey,
  renderStaticMapPng,
  StaticMapRenderError,
  type RenderStaticMapOptions,
} from "./static-map.js";
import { createStaticMapCache, type StaticMapCache } from "./static-map-cache.js";
import { buildGeocodingUserAgent } from "./user-agent.js";

export type ResolveEventStaticMapResult =
  | { ok: true; png: Buffer; cacheHit: boolean }
  | { ok: false; reason: "disabled" | "not_found" | "no_coordinates" | "render_failed" };

export interface EventStaticMapServiceOptions {
  cache?: StaticMapCache;
  renderOptions?: Partial<Pick<RenderStaticMapOptions, "fetchFn" | "timeoutMs">>;
  buildUserAgent?: (db: PrismaClient) => Promise<string>;
  /** Test seam - defaults to `renderStaticMapPng`. */
  renderPng?: typeof renderStaticMapPng;
}

export class EventStaticMapService {
  private readonly cache: StaticMapCache;
  private readonly renderOptions: Partial<Pick<RenderStaticMapOptions, "fetchFn" | "timeoutMs">>;
  private readonly buildUserAgent: (db: PrismaClient) => Promise<string>;
  private readonly renderPng: typeof renderStaticMapPng;

  constructor(options: EventStaticMapServiceOptions = {}) {
    this.cache = options.cache ?? createStaticMapCache();
    this.renderOptions = options.renderOptions ?? {};
    this.buildUserAgent = options.buildUserAgent ?? buildGeocodingUserAgent;
    this.renderPng = options.renderPng ?? renderStaticMapPng;
  }

  async getForEvent(db: PrismaClient, eventId: string): Promise<ResolveEventStaticMapResult> {
    const tileConfig = resolveMapTileConfig();
    if (!tileConfig.enabled) {
      return { ok: false, reason: "disabled" };
    }

    const event = await db.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        location_details: {
          select: {
            latitude: true,
            longitude: true,
            map_zoom: true,
          },
        },
      },
    });
    if (!event) {
      return { ok: false, reason: "not_found" };
    }
    const loc = event.location_details;
    if (!loc || !isMapReady(loc)) {
      return { ok: false, reason: "no_coordinates" };
    }

    // Ticket / mail maps read slightly closer than the admin preview (+1), capped by provider max.
    const req = {
      latitude: loc.latitude!,
      longitude: loc.longitude!,
      zoom: Math.min(loc.map_zoom + 1, tileConfig.maxZoom),
    };
    const cacheKey = buildStaticMapCacheKey(
      event.id,
      req,
      tileConfig.tileUrl,
      tileConfig.attribution,
    );
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return { ok: true, png: cached, cacheHit: true };
    }

    try {
      const userAgent = await this.buildUserAgent(db);
      const png = await this.renderPng(req, {
        tileConfig,
        userAgent,
        ...this.renderOptions,
      });
      await this.cache.set(cacheKey, png);
      return { ok: true, png, cacheHit: false };
    } catch (err) {
      if (!(err instanceof StaticMapRenderError)) {
        console.error("static_map_unexpected_error:", err);
      }
      return { ok: false, reason: "render_failed" };
    }
  }
}
