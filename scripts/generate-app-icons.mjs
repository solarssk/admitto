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

for (const [size, name] of [
  [32, "favicon-32.png"],
  [180, "apple-touch-icon.png"],
]) {
  const out = join(publicDir, name);
  await sharp(svg).resize(size, size).png().toFile(out);
  console.log(`wrote ${out}`);
}
