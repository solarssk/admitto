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
  const forcedTrack = () => declarations(blockOf(forced(), ".at-topbar {"));

  it("opts the bar out of the forced background, so its own colour is used", () => {
    expect(forcedBar()["forced-color-adjust"]).toBe("none");
  });

  it("opts the track out as well, since it is a background too", () => {
    expect(forcedTrack()["forced-color-adjust"]).toBe("none");
  });

  it("draws the bar in Highlight on a GrayText track, two different system colours, so the bar can be seen", () => {
    expect(forcedBar().background).toBe("Highlight");
    expect(forcedTrack().background).toBe("GrayText");
  });

  it.each([".at-topbar", ".at-topbar__bar"])("comes after the own rule of %s, so it wins on equal specificity", (selector) => {
    // The first rule of the file has no line break before it.
    const ownRule = topbarCss.search(new RegExp(`(^|\\n)${selector.replaceAll(".", "\\.")} \\{`));
    expect(ownRule, `the own rule of ${selector} exists`).toBeGreaterThan(-1);
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
    for (const rule of [forcedBar(), forcedTrack()]) {
      expect(Object.keys(rule).sort((a, b) => a.localeCompare(b))).toEqual(["background", "forced-color-adjust"]);
    }
  });
});
