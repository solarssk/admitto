#!/usr/bin/env node
/**
 * Regenerate the PNG email assets used by the system notification email:
 * - admitto-logo.png: rasterized straight from packages/ui/src/assets/admitto-logo.svg (classic
 *   desktop Outlook's Word rendering engine cannot display SVG <img> sources at all).
 * - notification-badge-{info,warn,error}.png: the whole severity badge (colored circle + icon)
 *   baked into one raster image, so its shape doesn't depend on `border-radius` (also ignored by
 *   that same Outlook engine on non-<v:roundrect> elements) and its glyph doesn't depend on a
 *   Unicode code point being present in the recipient's font.
 *
 *   node scripts/generate-notification-email-assets.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "apps/web/src/assets");
const sharp = (await import("sharp")).default;

// --- Logo: rasterize the real product lockup, 3x for retina (displayed at width=118 in email HTML) ---
const logoSvg = readFileSync(join(root, "packages/ui/src/assets/admitto-logo.svg"));
await sharp(logoSvg).resize(354, 108).png().toFile(join(outDir, "admitto-logo.png"));
console.log(`wrote ${join(outDir, "admitto-logo.png")}`);

// --- Severity badges: colored circle + a dot+bar glyph, composited as one SVG then rasterized ---
// A first version traced @tabler/icons' outline paths (2px stroke on a 24x24 viewBox) directly -
// at a 44px display size that stroke came out ~1.8px, too thin to read ("turbo nieczytelna", PO
// report). Rebuilt as solid filled shapes instead: same dot+bar glyph @tabler/icons' info-small/
// exclamation-mark use (a letterform, not an arbitrary icon) - dot-then-bar reads as "i" (info),
// bar-then-dot reads as "!" (warn/error) - just bold enough to read at badge size. Colors must
// match packages/notifications/src/channels/emailTemplate.ts's SEVERITY_COLOR - keep in sync by
// hand, there's no cross-package import from a root script.
const DOT_RADIUS = 6;
const BAR = { width: 12, height: 32, rx: 6 };
const GAP = 4;
// Centered in the 88px canvas: dot + GAP + bar (or bar + GAP + dot) spans this height, top-aligned
// so the whole glyph sits in the canvas's vertical center.
const GLYPH_TOP = (88 - (DOT_RADIUS * 2 + GAP + BAR.height)) / 2;

function dotThenBar() {
  const dotCy = GLYPH_TOP + DOT_RADIUS;
  const barY = GLYPH_TOP + DOT_RADIUS * 2 + GAP;
  return (
    `<circle cx="44" cy="${dotCy}" r="${DOT_RADIUS}" fill="#ffffff" />` +
    `<rect x="${44 - BAR.width / 2}" y="${barY}" width="${BAR.width}" height="${BAR.height}" rx="${BAR.rx}" fill="#ffffff" />`
  );
}

function barThenDot() {
  const barY = GLYPH_TOP;
  const dotCy = GLYPH_TOP + BAR.height + GAP + DOT_RADIUS;
  return (
    `<rect x="${44 - BAR.width / 2}" y="${barY}" width="${BAR.width}" height="${BAR.height}" rx="${BAR.rx}" fill="#ffffff" />` +
    `<circle cx="44" cy="${dotCy}" r="${DOT_RADIUS}" fill="#ffffff" />`
  );
}

const BADGES = [
  { name: "notification-badge-info.png", color: "#4299e1", glyph: dotThenBar() },
  { name: "notification-badge-warn.png", color: "#f59f00", glyph: barThenDot() },
  { name: "notification-badge-error.png", color: "#d63939", glyph: barThenDot() },
];

// 88px canvas (2x a 44px display size).
for (const badge of BADGES) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88" viewBox="0 0 88 88">
    <circle cx="44" cy="44" r="44" fill="${badge.color}" />
    ${badge.glyph}
  </svg>`;
  const out = join(outDir, badge.name);
  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log(`wrote ${out}`);
}
