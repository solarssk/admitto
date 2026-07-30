import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize, sep } from "node:path";
import type { Context, MiddlewareHandler } from "hono";

const require = createRequire(import.meta.url);

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/** Safely serve `relative` under `baseDir`: path-traversal guard, known-extension MIME lookup,
 * immutable caching. Shared by every self-hosted vendor asset route below (Tabler Icons,
 * @fontsource) so this exists in exactly one place - each route only differs in how it derives
 * `baseDir`/`relative` from its own URL shape. */
function serveVendorFile(c: Context, baseDir: string, relative: string): Response | Promise<Response> {
  const target = normalize(join(baseDir, relative));

  // Path traversal guard
  if (!target.startsWith(baseDir + sep) && target !== baseDir) {
    return c.text("Forbidden", 403);
  }

  const ext = target.slice(target.lastIndexOf("."));
  const contentType = MIME[ext];
  if (!contentType) return c.notFound();

  let body: Buffer;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path joined from a trusted, module-resolved dist root
    body = readFileSync(target);
  } catch {
    return c.notFound();
  }

  c.header("Content-Type", contentType);
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  return c.body(new Uint8Array(body));
}

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

  return serveVendorFile(c, TABLER_DIST, path.slice(PREFIX.length));
};

/** Absolute URL path for the self-hosted Tabler Icons stylesheet. */
export const TABLER_ICONS_CSS_PATH = "/vendor/tabler-icons/tabler-icons.min.css";

const FONTSOURCE_PACKAGES = ["inter", "manrope", "space-grotesk", "ibm-plex-sans"] as const;
type FontsourcePackage = (typeof FONTSOURCE_PACKAGES)[number];

function isFontsourcePackage(value: string): value is FontsourcePackage {
  return (FONTSOURCE_PACKAGES as readonly string[]).includes(value);
}

function resolveFontsourceFilesDir(pkg: FontsourcePackage): string {
  try {
    const pkgJsonPath = require.resolve(`@fontsource/${pkg}/package.json`);
    return join(dirname(pkgJsonPath), "files");
  } catch {
    return "";
  }
}

const FONTSOURCE_FILES_DIR: Record<FontsourcePackage, string> = Object.fromEntries(
  FONTSOURCE_PACKAGES.map((pkg) => [pkg, resolveFontsourceFilesDir(pkg)]),
) as Record<FontsourcePackage, string>;

/**
 * Serve the `files/` directory (the actual .woff2/.woff binaries) of each self-hosted
 * `@fontsource/*` built-in-font package at `/vendor/fontsource/<package>/*`. The ticket page has
 * no bundler and so can't `@import` `@fontsource`'s own CSS like the admin SPA does (see
 * packages/ui/src/styles/tokens/fonts.css) - builtInFontFaceCss below reads that same CSS
 * server-side instead and rewrites its relative `url(./files/...)` references to point here.
 *
 * Route: GET /vendor/fontsource/*
 */
export const serveFontsourceFonts: MiddlewareHandler = async (c) => {
  const path = c.req.path;
  const PREFIX = "/vendor/fontsource/";
  if (!path.startsWith(PREFIX)) return c.notFound();

  const rest = path.slice(PREFIX.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex < 0) return c.notFound();
  const pkg = rest.slice(0, slashIndex);
  const relative = rest.slice(slashIndex + 1);
  if (!isFontsourcePackage(pkg)) return c.notFound();

  const filesDir = FONTSOURCE_FILES_DIR[pkg];
  if (!filesDir) return c.notFound();

  return serveVendorFile(c, filesDir, relative);
};

// Weight/style CSS files to pull in per built-in family - kept in lockstep with
// packages/ui/src/styles/tokens/fonts.css's own @fontsource imports, so the ticket page (which
// can't bundle that CSS) renders identically to the admin SPA. "Inter" also covers the unnamed
// default pick ("Admitto Sans"), which resolveThemeVars never turns into an explicit
// font_family_name.
const BUILT_IN_FONT_SOURCES: Record<string, { pkg: FontsourcePackage; files: readonly string[] }> = {
  Inter: { pkg: "inter", files: ["400", "400-italic", "500", "600", "700", "700-italic"] },
  Manrope: { pkg: "manrope", files: ["400", "500", "600", "700"] },
  "Space Grotesk": { pkg: "space-grotesk", files: ["400", "500", "600", "700"] },
  "IBM Plex Sans": { pkg: "ibm-plex-sans", files: ["400", "400-italic", "500", "600", "700", "700-italic"] },
};

/** Reads one `@fontsource/<pkg>/<weightFile>.css` file and rewrites its relative
 * `url(./files/...)` references to the `/vendor/fontsource/<pkg>/...` route above, so the CSS text
 * stays correct once inlined into a page that isn't served from inside the package itself. */
function readFontsourceWeightCss(pkg: FontsourcePackage, weightFile: string): string {
  try {
    const cssPath = require.resolve(`@fontsource/${pkg}/${weightFile}.css`);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- pkg/weightFile only ever come from the fixed BUILT_IN_FONT_SOURCES manifest above, never from a request
    const raw = readFileSync(cssPath, "utf8");
    return raw.replaceAll("url(./files/", `url(/vendor/fontsource/${pkg}/`);
  } catch {
    return "";
  }
}

const BUILT_IN_FONT_FACE_CSS: Record<string, string> = Object.fromEntries(
  Object.entries(BUILT_IN_FONT_SOURCES).map(([family, { pkg, files }]) => [
    family,
    files.map((file) => readFontsourceWeightCss(pkg, file)).join(""),
  ]),
);

/** Self-hosted `@font-face` CSS for a built-in font family (Inter, Manrope, Space Grotesk, IBM
 * Plex Sans) - undefined for anything else. A custom uploaded family gets its `@font-face` from
 * `resolveThemeVars`'s own `fontFaceCss` instead (see ticket-inline-styles.ts, which only falls
 * back to this for whichever name that didn't already cover). */
export function builtInFontFaceCss(familyName: string): string | undefined {
  return BUILT_IN_FONT_FACE_CSS[familyName] || undefined;
}
