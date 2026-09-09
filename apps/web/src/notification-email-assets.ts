import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generates the PNG email assets used by the system notification email:
 * - admitto-logo.png: rasterized straight from packages/ui/src/assets/admitto-logo.svg (classic
 *   desktop Outlook's Word rendering engine cannot display SVG <img> sources at all).
 * - notification-badge-{info,warn,error}.png: the whole severity badge (colored circle + icon)
 *   baked into one raster image, so its shape doesn't depend on `border-radius` (also ignored by
 *   that same Outlook engine on non-<v:roundrect> elements) and its glyph doesn't depend on a
 *   Unicode code point being present in the recipient's font.
 *
 * Lives here (an apps/web module), not in the scripts/generate-notification-email-assets.mjs
 * wrapper that actually gets run - a root-level scripts/ file sits outside every workspace's
 * coverage collection in CI (.github/workflows/ci.yml's coverage-artifact globs only cover
 * apps/** and packages/**), so logic that only ever lived there could never show real test
 * coverage no matter how well-tested its behavior actually was.
 */

// A first version traced @tabler/icons' outline paths (2px stroke on a 24x24 viewBox) directly -
// at a 44px display size that stroke came out ~1.8px, too thin to read ("turbo nieczytelna", PO
// report). Rebuilt as solid filled shapes instead: same dot+bar glyph @tabler/icons' info-small/
// exclamation-mark use (a letterform, not an arbitrary icon) - dot-then-bar reads as "i" (info),
// bar-then-dot reads as "!" (warn/error) - just bold enough to read at badge size. Colors must
// match packages/notifications/src/channels/emailTemplate.ts's SEVERITY_COLOR - keep in sync by
// hand, there's no cross-package import from this module.
const DOT_RADIUS = 6;
const BAR = { width: 12, height: 32, rx: 6 };
const GAP = 4;
// Centered in the 88px canvas: dot + GAP + bar (or bar + GAP + dot) spans this height, top-aligned
// so the whole glyph sits in the canvas's vertical center.
const GLYPH_TOP = (88 - (DOT_RADIUS * 2 + GAP + BAR.height)) / 2;

/** Dot above a bar - reads as a lowercase "i" (tittle over the stem). */
export function dotThenBarGlyph(): string {
  const dotCy = GLYPH_TOP + DOT_RADIUS;
  const barY = GLYPH_TOP + DOT_RADIUS * 2 + GAP;
  return (
    `<circle cx="44" cy="${dotCy}" r="${DOT_RADIUS}" fill="#ffffff" />` +
    `<rect x="${44 - BAR.width / 2}" y="${barY}" width="${BAR.width}" height="${BAR.height}" rx="${BAR.rx}" fill="#ffffff" />`
  );
}

/** Bar above a dot - reads as "!" (stroke above the point). */
export function barThenDotGlyph(): string {
  const barY = GLYPH_TOP;
  const dotCy = GLYPH_TOP + BAR.height + GAP + DOT_RADIUS;
  return (
    `<rect x="${44 - BAR.width / 2}" y="${barY}" width="${BAR.width}" height="${BAR.height}" rx="${BAR.rx}" fill="#ffffff" />` +
    `<circle cx="44" cy="${dotCy}" r="${DOT_RADIUS}" fill="#ffffff" />`
  );
}

export interface NotificationBadgeSpec {
  fileName: string;
  color: string;
  glyph: string;
}

/** Matches packages/notifications/src/channels/emailTemplate.ts's SEVERITY_COLOR. */
export function notificationBadgeSpecs(): NotificationBadgeSpec[] {
  return [
    { fileName: "notification-badge-info.png", color: "#4299e1", glyph: dotThenBarGlyph() },
    { fileName: "notification-badge-warn.png", color: "#f59f00", glyph: barThenDotGlyph() },
    { fileName: "notification-badge-error.png", color: "#d63939", glyph: barThenDotGlyph() },
  ];
}

/** 88px canvas (2x a 44px display size): a filled circle plus the given glyph markup. */
export function buildNotificationBadgeSvg(color: string, glyph: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88" viewBox="0 0 88 88">
    <circle cx="44" cy="44" r="44" fill="${color}" />
    ${glyph}
  </svg>`;
}

/** This module resolves relative to its own file location, but that sits at a different depth
 * depending on how it's loaded: apps/web/src/notification-email-assets.ts (3 levels above repo
 * root - vitest's on-the-fly TS transform, tests) vs. apps/web/dist/src/notification-email-assets.js
 * (4 levels above - the compiled output the root script actually imports). Try both instead of
 * hardcoding one, and confirm with a file that's only ever at the real repo root. */
function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "../../.."), join(here, "../../../..")]) {
    if (existsSync(join(candidate, "packages/ui/src/assets/admitto-logo.svg"))) return candidate;
  }
  throw new Error(`Could not locate the repo root from ${here}`);
}

/**
 * Writes admitto-logo.png + the 3 severity badge PNGs to `outDir` (defaults to the real
 * apps/web/src/assets used by the running app - tests pass a temp directory instead).
 * Returns the full paths written, in write order.
 */
export async function generateNotificationEmailAssets(outDir?: string): Promise<string[]> {
  const root = repoRoot();
  const targetDir = outDir ?? join(root, "apps/web/src/assets");
  const sharp = (await import("sharp")).default;
  const written: string[] = [];

  // Logo: rasterize the real product lockup, 3x for retina (displayed at width=118 in email HTML).
  const logoSvg = readFileSync(join(root, "packages/ui/src/assets/admitto-logo.svg"));
  const logoOut = join(targetDir, "admitto-logo.png");
  await sharp(logoSvg).resize(354, 108).png().toFile(logoOut);
  written.push(logoOut);

  for (const badge of notificationBadgeSpecs()) {
    const svg = buildNotificationBadgeSvg(badge.color, badge.glyph);
    const out = join(targetDir, badge.fileName);
    await sharp(Buffer.from(svg)).png().toFile(out);
    written.push(out);
  }

  return written;
}
