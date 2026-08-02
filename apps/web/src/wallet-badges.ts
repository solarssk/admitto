import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "hono";

/** Exact public ticket assets — keep the allowlist tight so these routes never shadow SPA `/assets/*`. */
const ASSET_NAMES = new Set([
  "admitto-mark.svg",
  "apple-wallet-badge.svg",
  "google-wallet-badge.svg",
]);
const assetCache = new Map<string, Buffer>();

function assetRoots(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    join(here, "assets"),
    join(process.cwd(), "apps/web/dist/src/assets"),
    join(process.cwd(), "apps/web/src/assets"),
    join(process.cwd(), "src/assets"),
  ];
}

function readTicketAsset(name: string): Buffer | null {
  if (!ASSET_NAMES.has(name)) return null;
  const cached = assetCache.get(name);
  if (cached) return cached;
  for (const root of assetRoots()) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- name is restricted to the bundled allowlist
      const body = readFileSync(join(root, name));
      assetCache.set(name, body);
      return body;
    } catch {
      // try next bundled asset location
    }
  }
  return null;
}

function serveTicketAsset(c: Context, name: string): Response | Promise<Response> {
  const body = readTicketAsset(name);
  if (!body) return c.notFound();
  c.header("Content-Type", "image/svg+xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=86400");
  c.header("X-Content-Type-Options", "nosniff");
  return c.body(new Uint8Array(body));
}

/** GET handlers for Admitto mark + Wallet badges on the public ticket page.
 * Registered as exact paths so they do not shadow the staff SPA's `/assets/*` bundle. */
export function handleGetAdmittoMark(c: Context): Response | Promise<Response> {
  return serveTicketAsset(c, "admitto-mark.svg");
}

export function handleGetAppleWalletBadge(c: Context): Response | Promise<Response> {
  return serveTicketAsset(c, "apple-wallet-badge.svg");
}

export function handleGetGoogleWalletBadge(c: Context): Response | Promise<Response> {
  return serveTicketAsset(c, "google-wallet-badge.svg");
}
