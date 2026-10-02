import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const topbarCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/styles/components/topbar.css"),
  "utf8",
);

const FORCED_COLORS = "@media (forced-colors: active)";
const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";

/** The text between the braces of the first block that opens with `header`, nested blocks included. */
function blockOf(source: string, header: string): string {
  const start = source.indexOf(header);
  expect(start, `"${header}" exists`).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source.charAt(i);
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`"${header}" is never closed`);
}

/** The declarations of a rule body as a property map, comments left out. */
function declarations(body: string): Record<string, string> {
  const pairs = body
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .map((part): [string, string] => {
      const colon = part.indexOf(":");
      return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
    })
    .filter(([property]) => property !== "");
  return Object.fromEntries(pairs);
}

// jsdom does not load the stylesheet, so a rule that goes missing changes nothing in the component tests.
// This reads the source instead: Windows High Contrast replaces every background colour with the page colour
// (measured in Chrome with forced colours on: the bar's `var(--primary)` background computed to the same
// rgb(255, 255, 255) as the page), so a bar that is only a coloured background cannot be seen in any phase and
// only the dimming of a refetched card is left.
describe("top progress bar in forced-colors mode (Windows High Contrast)", () => {
  const forced = () => blockOf(topbarCss, FORCED_COLORS);
  const forcedBar = () => declarations(blockOf(forced(), ".at-topbar__bar"));

  it("opts the bar out of the forced background, so its own colour is used", () => {
    expect(forcedBar()["forced-color-adjust"]).toBe("none");
  });

  it("draws the bar in CanvasText, the colour the system guarantees to be readable on the page (Canvas)", () => {
    // Highlight on a GrayText track was tried and measured on the rendered pixels in Chrome's two forced
    // palettes: 1.36:1 in the light one and 1.01:1 in the dark one (cyan on green of the same brightness).
    // Highlight and GrayText have no guaranteed contrast with each other, CanvasText on Canvas has.
    expect(forcedBar().background).toBe("CanvasText");
  });

  it("puts the bar straight on the page: no track, nothing else in the block, no background on the container", () => {
    const selectors = forced()
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .match(/[^{}]+(?=\{)/g)
      ?.map((selector) => selector.trim());
    expect(selectors).toEqual([".at-topbar__bar"]);
    const container = declarations(blockOf(topbarCss, ".at-topbar {"));
    expect(container).not.toHaveProperty("background");
    expect(container).not.toHaveProperty("background-color");
  });

  it("comes after the bar's own rule, so it wins on equal specificity", () => {
    const ownRule = topbarCss.indexOf("\n.at-topbar__bar {");
    expect(ownRule, "the bar's own rule exists").toBeGreaterThan(-1);
    expect(topbarCss.indexOf(FORCED_COLORS)).toBeGreaterThan(ownRule);
  });

  it("covers the finishing phase and the reduced-motion bar: neither sets a background of its own that would win", () => {
    // The finishing rule is more specific than the forced one, so a `background` there would override it.
    const finishing = declarations(blockOf(topbarCss, '.at-topbar[data-phase="finishing"] .at-topbar__bar'));
    const reduced = declarations(blockOf(blockOf(topbarCss, REDUCED_MOTION), ".at-topbar__bar"));
    expect(finishing).not.toHaveProperty("background");
    expect(reduced).not.toHaveProperty("background");
  });

  it("changes colours only: the slide, the fill and the pulse are left alone", () => {
    expect(Object.keys(forcedBar()).sort((a, b) => a.localeCompare(b))).toEqual(["background", "forced-color-adjust"]);
  });
});
