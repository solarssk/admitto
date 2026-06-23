import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize, sep } from "node:path";
import type { MiddlewareHandler } from "hono";

const require = createRequire(import.meta.url);

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function resolveTablerIconsDist(): string {
  try {
    const cssPath = require.resolve("@tabler/icons-webfont/dist/tabler-icons.min.css");
    return dirname(cssPath);
  } catch {
    return "";
  }
}

const TABLER_DIST = resolveTablerIconsDist();

/**
 * Serve `@tabler/icons-webfont` dist files at `/vendor/tabler-icons/*`.
 * Covers `tabler-icons.min.css` and the `fonts/` subdirectory so the
 * webfont @font-face relative URL references resolve correctly.
 *
 * Route: GET /vendor/tabler-icons/*
 */
export const serveTablerIcons: MiddlewareHandler = async (c) => {
  if (!TABLER_DIST) return c.notFound();

  const path = c.req.path;
  const PREFIX = "/vendor/tabler-icons/";
  if (!path.startsWith(PREFIX)) return c.notFound();

  const relative = path.slice(PREFIX.length);
  const target = normalize(join(TABLER_DIST, relative));

  // Path traversal guard
  if (!target.startsWith(TABLER_DIST + sep) && target !== TABLER_DIST) {
    return c.text("Forbidden", 403);
  }

  const ext = target.slice(target.lastIndexOf("."));
  const contentType = MIME[ext];
  if (!contentType) return c.notFound();

  let body: Buffer;
  try {
    body = readFileSync(target);
  } catch {
    return c.notFound();
  }

  c.header("Content-Type", contentType);
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  return c.body(new Uint8Array(body));
};

/** Absolute URL path for the self-hosted Tabler Icons stylesheet. */
export const TABLER_ICONS_CSS_PATH = "/vendor/tabler-icons/tabler-icons.min.css";
