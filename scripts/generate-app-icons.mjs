#!/usr/bin/env node
/**
 * Regenerate PNG favicons from apps/admin/public/favicon.svg.
 * Requires: npm install --no-save sharp (not a repo dependency).
 *
 *   node scripts/generate-app-icons.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "apps/admin/public");
const svgPath = join(publicDir, "favicon.svg");

const sharp = (await import("sharp")).default;
const svg = readFileSync(svgPath);

// Brand blue from favicon.svg's own rounded-rect fill - used to flatten the apple touch icon.
const BRAND_BLUE = "#066fd1";

for (const [size, name] of [
  [32, "favicon-32.png"],
  [180, "apple-touch-icon.png"],
]) {
  const out = join(publicDir, name);
  let image = sharp(svg).resize(size, size);
  // iOS applies its own corner mask to home-screen icons and does not handle alpha
  // transparency well (corners can render solid black) - apple-touch-icon must be a fully
  // opaque square, unlike the browser-tab favicon which keeps its rounded-rect transparency.
  if (name === "apple-touch-icon.png") {
    image = image.flatten({ background: BRAND_BLUE });
  }
  await image.png().toFile(out);
  console.log(`wrote ${out}`);
}
