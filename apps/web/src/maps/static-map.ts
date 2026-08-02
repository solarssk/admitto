/**
 * Server-side static map PNG compositor for the public ticket / mail `{{event_map_url}}`.
 * Fetches raster tiles from the configured `MAP_TILE_URL` (never from the request), stitches
 * them with sharp, and burns a bottom-right attribution credit into the PNG (tickets and mail
 * have no separate HTML credit under the image).
 */
import { createHash } from "node:crypto";
import {
  isBlockedPrivateOrMetadataHost,
  isLoopbackHost,
  unbracketHostname,
} from "@admitto/shared/ssrf-guard";
import sharp, { type OverlayOptions } from "sharp";
import type { MapTileConfig } from "./config.js";

export const STATIC_MAP_WIDTH = 600;
export const STATIC_MAP_HEIGHT = 300;
const TILE_SIZE = 256;
const DEFAULT_TILE_TIMEOUT_MS = 8_000;
const MAX_TILE_BYTES = 512 * 1024;
const MAX_TILE_REDIRECTS = 3;
const ATTRIBUTION_OVERLAY_HEIGHT = 18;
/** Bump when burn-in layout changes so Redis/memory caches miss the old white-bar PNGs. */
const ATTRIBUTION_OVERLAY_VERSION = "br-halo-1";
/** PNG signature (ISO 15948) — reject non-image bodies before sharp composite. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type EnvLike = Record<string, string | undefined>;

/** True when a Content-Length value is a usable tile size (finite, non-negative, within cap). */
export function isAllowedDeclaredTileSize(declared: number, maxBytes: number): boolean {
  if (!Number.isFinite(declared)) return false;
  if (declared < 0) return false;
  if (declared > maxBytes) return false;
  return true;
}

/** True when the buffer starts with the PNG file signature. */
export function bufferLooksLikePng(buf: Buffer): boolean {
  return buf.length >= PNG_MAGIC.length && buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
}

function isDevLocalhostHttp(url: URL, env: EnvLike): boolean {
  return (
    env["NODE_ENV"] === "development" &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}

/**
 * Reject tile fetch URLs that are not https (except http://localhost in development) or that
 * target private / loopback / link-local / cloud-metadata hosts. Used for the initial expanded
 * tile URL and every redirect Location hop (`redirect: "manual"`).
 */
export function assertSafeTileFetchUrl(raw: string, env: EnvLike = process.env): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StaticMapRenderError(`Invalid tile URL: ${raw}`);
  }

  if (url.protocol === "https:") {
    // allowed
  } else if (isDevLocalhostHttp(url, env)) {
    return;
  } else {
    throw new StaticMapRenderError(`Tile URL must use https: ${raw}`);
  }

  const host = unbracketHostname(url.hostname);
  if (isLoopbackHost(host) || isBlockedPrivateOrMetadataHost(host)) {
    throw new StaticMapRenderError(`Tile URL host is blocked: ${host}`);
  }
}

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

/** Plain-text credit for the PNG burn-in (mail/ticket have no HTML attribution under the image). */
export function plainMapAttribution(attribution: string): string {
  return attribution
    .replaceAll("&copy;", "©")
    // Drop tags, keep their text (default MAP_TILE_ATTRIBUTION is HTML with <a href=…>).
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    // Residual angle brackets (malformed markup) must not reach the SVG text node.
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
    ATTRIBUTION_OVERLAY_VERSION,
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

/**
 * Bottom-right credit without an opaque bar (Leaflet-style halo text).
 * OSM requires legible attribution in a map corner — no fixed pt size; ~9px + stroke halo
 * matches common interactive map credits and stays readable on light/dark tiles.
 */
function buildAttributionOverlay(width: number, attribution: string): Buffer | null {
  const text = plainMapAttribution(attribution);
  if (!text) return null;
  const safe = escXmlText(text);
  const x = width - 6;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${ATTRIBUTION_OVERLAY_HEIGHT}">
      <text x="${x}" y="13" text-anchor="end" font-size="9"
        font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
        fill="#0f172a" stroke="rgba(255,255,255,0.92)" stroke-width="3"
        paint-order="stroke fill">${safe}</text>
    </svg>`,
  );
}

/** Memoized gray PNG for tile CDN outages — same size as a real static map so mail layout stays stable. */
let unavailableMapPng: Buffer | null = null;

/**
 * Placeholder image when tile fetch/composite fails after retries.
 * Served as HTTP 200 with a short Cache-Control so mail clients do not show a broken
 * image icon, without caching the failure for a full day like a real map.
 */
export async function buildUnavailableStaticMapPng(): Promise<Buffer> {
  if (unavailableMapPng) return unavailableMapPng;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${STATIC_MAP_WIDTH}" height="${STATIC_MAP_HEIGHT}">
  <rect width="100%" height="100%" fill="#f1f5f9"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
    font-size="16" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" fill="#64748b">Map unavailable</text>
</svg>`;
  unavailableMapPng = await sharp(Buffer.from(svg)).png().toBuffer();
  return unavailableMapPng;
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
    if (!isAllowedDeclaredTileSize(declared, maxBytes)) {
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

/** Resolve a 3xx Location against `current`, or throw. Cancels the redirect response body. */
async function nextTileRedirectUrl(response: Response, current: string): Promise<string> {
  const location = response.headers.get("location");
  await response.body?.cancel().catch(() => undefined);
  if (!location) {
    throw new StaticMapRenderError(`Tile redirect without Location: ${current}`);
  }
  try {
    return new URL(location, current).href;
  } catch {
    throw new StaticMapRenderError(`Tile redirect to invalid URL: ${location}`);
  }
}

async function fetchTilePng(
  url: string,
  userAgent: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
  /** Aborts the whole render attempt so sibling tiles stop when Promise.all fails. */
  attemptSignal?: AbortSignal,
): Promise<Buffer> {
  let current = url;
  for (let hop = 0; hop <= MAX_TILE_REDIRECTS; hop++) {
    assertSafeTileFetchUrl(current);

    const signal = attemptSignal
      ? AbortSignal.any([AbortSignal.timeout(timeoutMs), attemptSignal])
      : AbortSignal.timeout(timeoutMs);

    let response: Response;
    try {
      response = await fetchFn(current, {
        headers: {
          "User-Agent": userAgent,
          Accept: "image/png,image/*;q=0.8,*/*;q=0.5",
        },
        redirect: "manual",
        signal,
      });
    } catch (err) {
      throw new StaticMapRenderError(`Tile fetch failed: ${current}`, err);
    }

    if (response.status >= 300 && response.status < 400) {
      current = await nextTileRedirectUrl(response, current);
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new StaticMapRenderError(`Tile HTTP ${response.status}: ${current}`);
    }

    const body = await readTileBodyCapped(response, MAX_TILE_BYTES, current);
    if (!bufferLooksLikePng(body)) {
      throw new StaticMapRenderError(`Tile is not a PNG: ${current}`);
    }
    return body;
  }

  throw new StaticMapRenderError(`Too many tile redirects: ${url}`);
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

  // One controller for the attempt: if any tile fails, abort siblings before the caller retries.
  const attempt = new AbortController();
  const tileJobs: Array<Promise<OverlayOptions>> = [];
  for (let ty = tileY0; ty <= tileY1; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = tileX0; tx <= tileX1; tx++) {
      const wrappedX = ((tx % n) + n) % n;
      const url = expandTileUrl(options.tileConfig.tileUrl, zoom, wrappedX, ty);
      tileJobs.push(
        fetchTilePng(url, options.userAgent, fetchFn, timeoutMs, attempt.signal).then((tilePng) => ({
          input: tilePng,
          left: Math.round(tx * TILE_SIZE - topLeftPxX),
          top: Math.round(ty * TILE_SIZE - topLeftPxY),
        })),
      );
    }
  }

  let composites: OverlayOptions[];
  try {
    composites = await Promise.all(tileJobs);
  } catch (err) {
    attempt.abort();
    throw err instanceof StaticMapRenderError
      ? err
      : new StaticMapRenderError("Tile fetch failed", err);
  }

  if (composites.length === 0) {
    throw new StaticMapRenderError("No map tiles covered the requested viewport");
  }

  const pinLeft = Math.round(width / 2 - 14);
  const pinTop = Math.round(height / 2 - 14);
  composites.push({ input: PIN_SVG, left: pinLeft, top: pinTop });

  const attrOverlay = buildAttributionOverlay(width, options.tileConfig.attribution);
  if (attrOverlay) {
    composites.push({ input: attrOverlay, left: 0, top: height - ATTRIBUTION_OVERLAY_HEIGHT });
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
