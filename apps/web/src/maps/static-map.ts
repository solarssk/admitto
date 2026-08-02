/**
 * Server-side static map PNG compositor for the public ticket / mail `{{event_map_url}}`.
 * Fetches raster tiles from the configured `MAP_TILE_URL` (never from the request), stitches
 * them with sharp, and draws a center pin plus a burned-in attribution strip (mail has no
 * surrounding HTML credit).
 */
import { createHash } from "node:crypto";
import sharp, { type OverlayOptions } from "sharp";
import type { MapTileConfig } from "./config.js";

export const STATIC_MAP_WIDTH = 600;
export const STATIC_MAP_HEIGHT = 300;
const TILE_SIZE = 256;
const DEFAULT_TILE_TIMEOUT_MS = 8_000;
const MAX_TILE_BYTES = 512 * 1024;
const ATTRIBUTION_BAR_HEIGHT = 18;

export interface StaticMapRequest {
  latitude: number;
  longitude: number;
  zoom: number;
  width?: number;
  height?: number;
}

export interface RenderStaticMapOptions {
  tileConfig: MapTileConfig;
  userAgent: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class StaticMapRenderError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "StaticMapRenderError";
    this.cause = cause;
  }
}

/** Plain-text credit for the PNG strip (mail has no HTML attribution under the image). */
export function plainMapAttribution(attribution: string): string {
  return attribution
    .replaceAll("&copy;", "©")
    .replaceAll("<", "")
    .replaceAll(">", "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cache key includes tile template + size + attribution so a deploy config change misses stale images. */
export function buildStaticMapCacheKey(
  eventId: string,
  req: StaticMapRequest,
  tileUrl: string,
  attribution = "",
): string {
  const width = req.width ?? STATIC_MAP_WIDTH;
  const height = req.height ?? STATIC_MAP_HEIGHT;
  const payload = [
    eventId,
    req.latitude.toFixed(6),
    req.longitude.toFixed(6),
    String(req.zoom),
    String(width),
    String(height),
    tileUrl,
    plainMapAttribution(attribution),
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

function clampZoom(zoom: number, maxZoom: number): number {
  if (!Number.isFinite(zoom)) return Math.min(15, maxZoom);
  return Math.max(1, Math.min(Math.round(zoom), maxZoom));
}

/** Web Mercator fractional tile coordinates (EPSG:3857 / OSM tiling). */
export function latLngToTileFraction(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

function expandTileUrl(template: string, z: number, x: number, y: number): string {
  const subdomains = ["a", "b", "c"] as const;
  const s = subdomains[(x + y) % subdomains.length]!;
  return template
    .replaceAll("{s}", s)
    .replaceAll("{z}", String(z))
    .replaceAll("{x}", String(x))
    .replaceAll("{y}", String(y))
    .replaceAll("{r}", "");
}

const PIN_SVG = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
    <circle cx="14" cy="14" r="10" fill="#2563eb" stroke="#ffffff" stroke-width="3"/>
  </svg>`,
);

function escXmlText(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildAttributionOverlay(width: number, attribution: string): Buffer | null {
  const text = plainMapAttribution(attribution);
  if (!text) return null;
  const safe = escXmlText(text);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${ATTRIBUTION_BAR_HEIGHT}">
      <rect width="100%" height="100%" fill="rgba(255,255,255,0.82)"/>
      <text x="6" y="12" font-size="9" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" fill="#334155">${safe}</text>
    </svg>`,
  );
}

/**
 * Read the response body incrementally and abort once `maxBytes` is exceeded.
 * Do not rely on `Content-Length` alone - chunked responses omit it, and a lying
 * header must not let an oversized body buffer into process memory.
 */
async function readTileBodyCapped(res: Response, maxBytes: number, url: string): Promise<Buffer> {
  if (!res.body) {
    throw new StaticMapRenderError(`Tile empty body: ${url}`);
  }

  const contentLength = res.headers.get("content-length");
  if (contentLength != null) {
    const declared = Number(contentLength);
    // NaN and negatives fail `declared >= 0`; oversize fails the upper bound.
    if (!(declared >= 0 && declared <= maxBytes)) {
      await res.body.cancel().catch(() => undefined);
      throw new StaticMapRenderError(`Tile too large (declared ${declared} bytes): ${url}`);
    }
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new StaticMapRenderError(`Tile too large (${total} bytes): ${url}`);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof StaticMapRenderError) throw err;
    throw new StaticMapRenderError(`Tile read failed: ${url}`, err);
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

async function fetchTilePng(
  url: string,
  userAgent: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: {
        "User-Agent": userAgent,
        Accept: "image/png,image/*;q=0.8,*/*;q=0.5",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new StaticMapRenderError(`Tile fetch failed: ${url}`, err);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new StaticMapRenderError(`Tile HTTP ${response.status}: ${url}`);
  }
  return readTileBodyCapped(response, MAX_TILE_BYTES, url);
}

/**
 * Render a static map PNG centered on lat/lng at the given zoom.
 * Burns configured map attribution into a bottom strip so mail `{{event_map_url}}`
 * (PNG-only) still carries the OSM/CARTO credit; the ticket page keeps its HTML credit too.
 */
export async function renderStaticMapPng(
  req: StaticMapRequest,
  options: RenderStaticMapOptions,
): Promise<Buffer> {
  if (!options.tileConfig.enabled) {
    throw new StaticMapRenderError("Maps are disabled (LOCATION_MAPS_ENABLED=false)");
  }
  const width = req.width ?? STATIC_MAP_WIDTH;
  const height = req.height ?? STATIC_MAP_HEIGHT;
  const zoom = clampZoom(req.zoom, options.tileConfig.maxZoom);
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TILE_TIMEOUT_MS;

  const center = latLngToTileFraction(req.latitude, req.longitude, zoom);
  const centerPxX = center.x * TILE_SIZE;
  const centerPxY = center.y * TILE_SIZE;
  const topLeftPxX = centerPxX - width / 2;
  const topLeftPxY = centerPxY - height / 2;

  const tileX0 = Math.floor(topLeftPxX / TILE_SIZE);
  const tileY0 = Math.floor(topLeftPxY / TILE_SIZE);
  const tileX1 = Math.floor((topLeftPxX + width - 1) / TILE_SIZE);
  const tileY1 = Math.floor((topLeftPxY + height - 1) / TILE_SIZE);
  const n = 2 ** zoom;

  const tileJobs: Array<Promise<OverlayOptions>> = [];
  for (let ty = tileY0; ty <= tileY1; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = tileX0; tx <= tileX1; tx++) {
      const wrappedX = ((tx % n) + n) % n;
      const url = expandTileUrl(options.tileConfig.tileUrl, zoom, wrappedX, ty);
      tileJobs.push(
        fetchTilePng(url, options.userAgent, fetchFn, timeoutMs).then((tilePng) => ({
          input: tilePng,
          left: Math.round(tx * TILE_SIZE - topLeftPxX),
          top: Math.round(ty * TILE_SIZE - topLeftPxY),
        })),
      );
    }
  }
  const composites: OverlayOptions[] = await Promise.all(tileJobs);

  if (composites.length === 0) {
    throw new StaticMapRenderError("No map tiles covered the requested viewport");
  }

  const pinLeft = Math.round(width / 2 - 14);
  const pinTop = Math.round(height / 2 - 14);
  composites.push({ input: PIN_SVG, left: pinLeft, top: pinTop });

  const attrOverlay = buildAttributionOverlay(width, options.tileConfig.attribution);
  if (attrOverlay) {
    composites.push({ input: attrOverlay, left: 0, top: height - ATTRIBUTION_BAR_HEIGHT });
  }

  try {
    return await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 230, g: 235, b: 240 },
      },
    })
      .composite(composites)
      .png()
      .toBuffer();
  } catch (err) {
    throw new StaticMapRenderError("Failed to composite static map", err);
  }
}
