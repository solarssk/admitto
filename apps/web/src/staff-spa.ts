import { readFileSync, existsSync, statSync } from "node:fs";
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

function defaultAdminDistRoot(): string {
  const fromCwd = normalize(join(process.cwd(), "apps/admin/dist"));
  if (existsSync(join(fromCwd, "index.html"))) return fromCwd;

  const here = dirname(fileURLToPath(import.meta.url));
  return normalize(join(here, "../../../../admin/dist"));
}

function safeJoin(root: string, relative: string): string | null {
  const target = normalize(join(root, relative));
  if (!target.startsWith(root + sep) && target !== root) return null;
  return target;
}

function readDistFile(root: string, relative: string): { body: Buffer; contentType: string } | null {
  const filePath = safeJoin(root, relative);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) return null;
  const ext = filePath.slice(filePath.lastIndexOf("."));
  const contentType = MIME[ext] ?? "application/octet-stream";
  try {
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
    c.header("Cache-Control", "no-store");
    return c.body(new Uint8Array(file.body));
  };

  return { serveAsset, serveSpaIndex, distRoot: root };
}
