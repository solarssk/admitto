import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "hono";

/** Admitto mark as favicon SVG (source: packages/ui/src/assets/admitto-mark.svg). */
export const ADMITTO_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="7.5" fill="#066fd1"/><path d="M9.5 16.5l4.2 4.2 7.5-9" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="22.5" y="6" width="4" height="4" rx="1" fill="#ffffff" fill-opacity="0.55"/></svg>`;

const ICON_CACHE = new Map<string, Buffer>();

function iconAssetRoots(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    join(here, "../../admin/dist"),
    join(process.cwd(), "apps/admin/dist"),
    join(here, "../../admin/public"),
    join(process.cwd(), "apps/admin/public"),
  ];
}

function readIconAsset(name: string): Buffer | null {
  const cached = ICON_CACHE.get(name);
  if (cached) return cached;
  for (const root of iconAssetRoots()) {
    try {
      const body = readFileSync(join(root, name));
      ICON_CACHE.set(name, body);
      return body;
    } catch {
      // try next root
    }
  }
  return null;
}

/** Head links for auth/admin HTML (requires img-src 'self' in page CSP). */
export function renderAdmittoFaviconLink(): string {
  return [
    `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`,
    `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`,
  ].join("\n  ");
}

function servePng(c: Context, name: string, cacheControl: string): Response | Promise<Response> {
  const body = readIconAsset(name);
  if (!body) return c.notFound();
  c.header("Content-Type", "image/png");
  c.header("Cache-Control", cacheControl);
  return c.body(new Uint8Array(body));
}

/** GET /favicon.svg */
export function handleGetFaviconSvg(c: Context): Response {
  c.header("Content-Type", "image/svg+xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(ADMITTO_FAVICON_SVG);
}

/** GET /favicon-32.png — Safari / legacy tab icons. */
export function handleGetFavicon32Png(c: Context): Response | Promise<Response> {
  return servePng(c, "favicon-32.png", "public, max-age=86400");
}

/** GET /apple-touch-icon.png — iOS / iPadOS home screen and Safari. */
export function handleGetAppleTouchIcon(c: Context): Response | Promise<Response> {
  return servePng(c, "apple-touch-icon.png", "public, max-age=86400");
}

/** GET /favicon.ico — default browser probe; serve 32px PNG (Safari-friendly). */
export function handleGetFaviconIco(c: Context): Response | Promise<Response> {
  const png = readIconAsset("favicon-32.png");
  if (png) {
    c.header("Content-Type", "image/png");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(new Uint8Array(png));
  }
  return handleGetFaviconSvg(c);
}

/** GET /apple-touch-icon-precomposed.png — legacy iOS path. */
export function handleGetAppleTouchIconPrecomposed(c: Context): Response | Promise<Response> {
  return handleGetAppleTouchIcon(c);
}

/** CSP img-src fragment for strict auth HTML pages that declare icon link tags. */
export const AUTH_PAGE_ICON_CSP = "img-src 'self' data:";
