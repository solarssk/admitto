/**
 * Server-side static map PNG compositor for the public ticket / mail `{{event_map_url}}`.
 * Fetches raster tiles from the configured `MAP_TILE_URL` (never from the request), stitches
 * them with sharp, and draws a center pin. No commercial static-map API keys.
 */
import { createHash } from "node:crypto";
import sharp, { type OverlayOptions } from "sharp";
import type { MapTileConfig } from "./config.js";

export const STATIC_MAP_WIDTH = 600;
export const STATIC_MAP_HEIGHT = 300;
const TILE_SIZE = 256;
const DEFAULT_TILE_TIMEOUT_MS = 8_000;
const MAX_TILE_BYTES = 512 * 1024;

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

/** Cache key includes tile template + size so a deploy config change misses stale images. */
export function buildStaticMapCacheKey(
  eventId: string,
  req: StaticMapRequest,
  tileUrl: string,
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
  const subdomains = ["a", "b", "c"];
  const s = subdomains[(x + y) % subdomains.length] ?? "a";
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
    throw new StaticMapRenderError(`Tile HTTP ${response.status}: ${url}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.byteLength > MAX_TILE_BYTES) {
    throw new StaticMapRenderError(`Tile too large (${buf.byteLength} bytes): ${url}`);
  }
  return buf;
}

/**
 * Render a static map PNG centered on lat/lng at the given zoom.
 * Attribution stays in surrounding HTML (ticket / mail) — burned-in text at 600×300 is
 * too small to read and duplicates the clickable credit under the image.
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

  const composites: OverlayOptions[] = [];
  for (let ty = tileY0; ty <= tileY1; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = tileX0; tx <= tileX1; tx++) {
      const wrappedX = ((tx % n) + n) % n;
      const url = expandTileUrl(options.tileConfig.tileUrl, zoom, wrappedX, ty);
      const tilePng = await fetchTilePng(url, options.userAgent, fetchFn, timeoutMs);
      composites.push({
        input: tilePng,
        left: Math.round(tx * TILE_SIZE - topLeftPxX),
        top: Math.round(ty * TILE_SIZE - topLeftPxY),
      });
    }
  }

  if (composites.length === 0) {
    throw new StaticMapRenderError("No map tiles covered the requested viewport");
  }

  const pinLeft = Math.round(width / 2 - 14);
  const pinTop = Math.round(height / 2 - 14);
  composites.push({ input: PIN_SVG, left: pinLeft, top: pinTop });

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
