import { readFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "hono";
import type { MiddlewareHandler } from "hono";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

/** Stylesheet origins for bundled staff SPA CSS (self-hosted; no external CDNs). */
export const STAFF_SPA_STYLE_SRC = ["'self'", "'unsafe-inline'"] as const;

/**
 * Font origins for self-hosted Inter/Tabler icons and optional org theme `@font-face` URLs.
 * `https:` allows arbitrary HTTPS branding font hosts validated in `@admitto/ui` (opt-in superadmin).
 */
export const STAFF_SPA_FONT_SRC = ["'self'", "https:"] as const;

/**
 * Image origins for bundled staff UI assets and optional org branding logo URLs.
 * `https:` allows arbitrary HTTPS logo hosts validated in branding forms (opt-in superadmin).
 * Intentionally aligned with `STAFF_SPA_FONT_SRC`; upload-based assets (ADR 0008) will tighten this.
 */
export const STAFF_SPA_IMG_SRC = ["'self'", "data:", "https:"] as const;

function buildStaffSpaContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    `style-src ${STAFF_SPA_STYLE_SRC.join(" ")}`,
    `img-src ${STAFF_SPA_IMG_SRC.join(" ")}`,
    "connect-src 'self'",
    `font-src ${STAFF_SPA_FONT_SRC.join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Security headers for `/admin` and `/operator` SPA shell (Vite bundle). */
export function getStaffSpaSecurityHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": buildStaffSpaContentSecurityPolicy(),
    // same-origin (not no-referrer) so Safari sends Referer on same-origin form POSTs
    // (e.g. Sign out). no-referrer blocks Referer and Safari omits Origin for same-origin
    // form POST, causing the CSRF guard to reject the request.
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function defaultAdminDistRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    normalize(join(here, "../../admin/dist")),
    normalize(join(process.cwd(), "apps/admin/dist")),
    normalize(join(process.cwd(), "../admin/dist")),
  ];
  for (const root of candidates) {
    try {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path joined from trusted repo root or upload dir
      readFileSync(join(root, "index.html"));
      return root;
    } catch {
      // try next candidate
    }
  }
  return candidates[0]!;
}

function safeJoin(root: string, relative: string): string | null {
  const target = normalize(join(root, relative));
  if (!target.startsWith(root + sep) && target !== root) return null;
  return target;
}

function readDistFile(root: string, relative: string): { body: Buffer; contentType: string } | null {
  const filePath = safeJoin(root, relative);
  if (!filePath) return null;
  const ext = filePath.slice(filePath.lastIndexOf("."));
  const contentType = MIME[ext] ?? "application/octet-stream";
  try {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path joined from trusted repo root or upload dir
    return { body: readFileSync(filePath), contentType };
  } catch {
    return null;
  }
}

export interface StaffSpaOptions {
  distRoot?: string;
}

/** Serve built Vite assets and SPA index.html fallback for staff routes. */
export function createStaffSpaHandlers(options: StaffSpaOptions = {}) {
  const root = normalize(options.distRoot ?? defaultAdminDistRoot());
  const indexHtml = () => readDistFile(root, "index.html");

  const serveAsset: MiddlewareHandler = async (c) => {
    const path = c.req.path;
    if (!path.startsWith("/assets/")) return c.notFound();
    const file = readDistFile(root, path.slice(1));
    if (!file) return c.notFound();
    c.header("Content-Type", file.contentType);
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(new Uint8Array(file.body));
  };

  const serveSpaIndex = (c: Context) => {
    const file = indexHtml();
    if (!file) {
      return c.text("Staff UI not built. Run npm run build -w @admitto/admin.", 503);
    }
    c.header("Content-Type", file.contentType);
    for (const [name, value] of Object.entries(getStaffSpaSecurityHeaders())) {
      c.header(name, value);
    }
    return c.body(new Uint8Array(file.body));
  };

  return { serveAsset, serveSpaIndex, distRoot: root };
}
