/**
 * Resolve (or generate) a cached static map PNG for an event that has coordinates.
 */
import type { PrismaClient } from "@admitto/db";
import { isMapReady } from "@admitto/location";
import { emitSystemLog } from "@admitto/shared/system-log";
import { resolveMapTileConfig } from "./config.js";
import {
  buildStaticMapCacheKey,
  buildUnavailableStaticMapPng,
  redactTileUrlForLogs,
  renderStaticMapPng,
  StaticMapRenderError,
  STATIC_MAP_LIST_HEIGHT,
  STATIC_MAP_LIST_WIDTH,
  type RenderStaticMapOptions,
} from "./static-map.js";
import { createStaticMapCache, type StaticMapCache } from "./static-map-cache.js";
import { buildGeocodingUserAgent } from "./user-agent.js";

const RENDER_ATTEMPTS = 2;
const RENDER_RETRY_DELAY_MS = 250;
/** In-memory only — avoid hammering a dead tile CDN; short so recovery is quick. */
export const STATIC_MAP_NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000;
/** Browser/mail-proxy cache for placeholder PNGs (matches negative TTL). */
export const STATIC_MAP_PLACEHOLDER_MAX_AGE_SEC = 120;
/** Browser/mail-proxy cache for successfully rendered maps. */
export const STATIC_MAP_SUCCESS_MAX_AGE_SEC = 86_400;

export type ResolveEventStaticMapResult =
  | { ok: true; png: Buffer; cacheHit: boolean; placeholder?: boolean }
  | { ok: false; reason: "disabled" | "not_found" | "no_coordinates" };

export interface EventStaticMapServiceOptions {
  cache?: StaticMapCache;
  renderOptions?: Partial<Pick<RenderStaticMapOptions, "fetchFn" | "timeoutMs">>;
  buildUserAgent?: (db: PrismaClient) => Promise<string>;
  /** Test seam - defaults to `renderStaticMapPng`. */
  renderPng?: typeof renderStaticMapPng;
  /** Test seam - defaults to `buildUnavailableStaticMapPng`. */
  buildPlaceholderPng?: () => Promise<Buffer>;
  sleepMs?: (ms: number) => Promise<void>;
  nowMs?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Defense in depth: never put credential-bearing tile URLs into system logs. */
function sanitizeStaticMapLogReason(message: string): string {
  return message
    .replace(/https?:\/\/\S+/gi, (url) => redactTileUrlForLogs(url))
    .slice(0, 200);
}

export type GetForEventOptions = {
  /**
   * Relative to stored `EventLocation.map_zoom`.
   * Ticket/mail default is +1 (slightly closer). Pass a negative bias to zoom out,
   * or use `listPreview` for Events-card maps (hard-capped wider view).
   */
  zoomBias?: number;
  /** Events list / operator picker — wider neighbourhood context, capped for consistency. */
  listPreview?: boolean;
};

/** Max zoom for Events list card thumbnails (street-level admin zoom is too tight). */
export const STATIC_MAP_LIST_PREVIEW_MAX_ZOOM = 12;

export class EventStaticMapService {
  private readonly cache: StaticMapCache;
  private readonly renderOptions: Partial<Pick<RenderStaticMapOptions, "fetchFn" | "timeoutMs">>;
  private readonly buildUserAgent: (db: PrismaClient) => Promise<string>;
  private readonly renderPng: typeof renderStaticMapPng;
  private readonly buildPlaceholderPng: () => Promise<Buffer>;
  private readonly sleepMs: (ms: number) => Promise<void>;
  private readonly nowMs: () => number;
  private readonly inFlight = new Map<string, Promise<ResolveEventStaticMapResult>>();
  /** cacheKey → expiry epoch ms (do not store failures in Redis positive cache). */
  private readonly negativeUntil = new Map<string, number>();

  constructor(options: EventStaticMapServiceOptions = {}) {
    this.cache = options.cache ?? createStaticMapCache();
    this.renderOptions = options.renderOptions ?? {};
    this.buildUserAgent = options.buildUserAgent ?? buildGeocodingUserAgent;
    this.renderPng = options.renderPng ?? renderStaticMapPng;
    this.buildPlaceholderPng = options.buildPlaceholderPng ?? buildUnavailableStaticMapPng;
    this.sleepMs = options.sleepMs ?? defaultSleep;
    this.nowMs = options.nowMs ?? Date.now;
  }

  private async placeholderResult(cacheHit: boolean): Promise<ResolveEventStaticMapResult> {
    return {
      ok: true,
      png: await this.buildPlaceholderPng(),
      cacheHit,
      placeholder: true,
    };
  }

  private isNegativeCached(cacheKey: string): boolean {
    const until = this.negativeUntil.get(cacheKey);
    if (until == null) return false;
    if (this.nowMs() >= until) {
      this.negativeUntil.delete(cacheKey);
      return false;
    }
    return true;
  }

  private markNegative(cacheKey: string): void {
    this.negativeUntil.set(cacheKey, this.nowMs() + STATIC_MAP_NEGATIVE_CACHE_TTL_MS);
  }

  private async renderWithRetry(
    req: {
      latitude: number;
      longitude: number;
      zoom: number;
      width?: number;
      height?: number;
    },
    userAgent: string,
    tileConfig: ReturnType<typeof resolveMapTileConfig>,
  ): Promise<Buffer> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= RENDER_ATTEMPTS; attempt++) {
      try {
        return await this.renderPng(req, {
          tileConfig,
          userAgent,
          ...this.renderOptions,
        });
      } catch (err) {
        lastErr = err;
        if (attempt < RENDER_ATTEMPTS) {
          await this.sleepMs(RENDER_RETRY_DELAY_MS);
        }
      }
    }
    throw lastErr;
  }

  async getForEvent(
    db: PrismaClient,
    eventId: string,
    options: GetForEventOptions = {},
  ): Promise<ResolveEventStaticMapResult> {
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

    // Ticket / mail maps read slightly closer than the stored admin zoom (+1).
    // List-card previews use a hard-capped wider view so stadium/venue pins
    // still show neighbourhood context (admin map_zoom is often 15–17).
    const zoomBias = options.zoomBias ?? 1;
    const zoom = options.listPreview
      ? Math.min(
          Math.max(1, loc.map_zoom + (options.zoomBias ?? -3)),
          STATIC_MAP_LIST_PREVIEW_MAX_ZOOM,
        )
      : Math.min(Math.max(1, loc.map_zoom + zoomBias), tileConfig.maxZoom);
    const req = {
      latitude: loc.latitude!,
      longitude: loc.longitude!,
      zoom,
      ...(options.listPreview
        ? {
            width: STATIC_MAP_LIST_WIDTH,
            height: STATIC_MAP_LIST_HEIGHT,
          }
        : {}),
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

    if (this.isNegativeCached(cacheKey)) {
      return this.placeholderResult(false);
    }

    const pending = this.inFlight.get(cacheKey);
    if (pending) return pending;

    const renderTask = (async (): Promise<ResolveEventStaticMapResult> => {
      try {
        const userAgent = await this.buildUserAgent(db);
        const png = await this.renderWithRetry(req, userAgent, tileConfig);
        this.negativeUntil.delete(cacheKey);
        await this.cache.set(cacheKey, png);
        return { ok: true, png, cacheHit: false };
      } catch (err) {
        if (err instanceof StaticMapRenderError) {
          // Once per negative-cache window (not on every subsequent placeholder hit).
          emitSystemLog("cache", "warn", "static_map_unavailable", {
            eventId,
            reason: sanitizeStaticMapLogReason(err.message),
          });
        } else {
          console.error("static_map_unexpected_error:", err);
          emitSystemLog("cache", "error", "static_map_unexpected_error", {
            eventId,
            reason: sanitizeStaticMapLogReason(
              err instanceof Error ? err.message : "unknown",
            ),
          });
        }
        this.markNegative(cacheKey);
        return this.placeholderResult(false);
      } finally {
        this.inFlight.delete(cacheKey);
      }
    })();
    this.inFlight.set(cacheKey, renderTask);
    return renderTask;
  }
}
