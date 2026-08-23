import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "hono";

/** Exact public ticket assets: keep the allowlist tight so these routes never shadow SPA `/assets/*`.
 * PNG wallet badges exist alongside the SVGs for email use only (classic Outlook desktop's Word
 * rendering engine does not display SVG `<img>` sources at all) - the ticket page keeps the SVGs. */
const ASSET_NAMES = new Set([
  "admitto-mark.svg",
  "admitto-logo.svg",
  "apple-wallet-badge.svg",
  "google-wallet-badge.svg",
  "apple-wallet-badge.png",
  "google-wallet-badge.png",
]);
const assetCache = new Map<string, Buffer>();

function assetRoots(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    // Product brand SVGs (mark + full logo): emitted into @admitto/ui dist/assets on
    // `npm run build -w @admitto/ui`. Production image copies packages/ui/dist only
    // (not packages/ui/src), so dist must be first. src/ is for local tsx / pre-build.
    join(process.cwd(), "packages/ui/dist/assets"),
    join(here, "../../../packages/ui/dist/assets"),
    join(process.cwd(), "packages/ui/src/assets"),
    join(here, "../../../packages/ui/src/assets"),
    // Wallet badges (and any product SVG copied into the web package).
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

/** @internal unit-test helper for the allowlist / missing-file paths. */
export function readTicketAssetForTest(name: string): Buffer | null {
  return readTicketAsset(name);
}

function serveTicketAsset(c: Context, name: string): Response | Promise<Response> {
  const body = readTicketAsset(name);
  if (!body) return c.notFound();
  c.header("Content-Type", name.endsWith(".png") ? "image/png" : "image/svg+xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=86400");
  c.header("X-Content-Type-Options", "nosniff");
  return c.body(new Uint8Array(body));
}

/** GET handlers for Admitto mark/logo + Wallet badges on the public ticket page.
 * Registered as exact paths so they do not shadow the staff SPA's `/assets/*` bundle. */
export function handleGetAdmittoMark(c: Context): Response | Promise<Response> {
  return serveTicketAsset(c, "admitto-mark.svg");
}

export function handleGetAdmittoLogo(c: Context): Response | Promise<Response> {
  return serveTicketAsset(c, "admitto-logo.svg");
}

export function handleGetAppleWalletBadge(c: Context): Response | Promise<Response> {
  return serveTicketAsset(c, "apple-wallet-badge.svg");
}

export function handleGetGoogleWalletBadge(c: Context): Response | Promise<Response> {
  return serveTicketAsset(c, "google-wallet-badge.svg");
}

/** PNG variant for email markup - see the `ASSET_NAMES` comment above. */
export function handleGetAppleWalletBadgePng(c: Context): Response | Promise<Response> {
  return serveTicketAsset(c, "apple-wallet-badge.png");
}

export function handleGetGoogleWalletBadgePng(c: Context): Response | Promise<Response> {
  return serveTicketAsset(c, "google-wallet-badge.png");
}
